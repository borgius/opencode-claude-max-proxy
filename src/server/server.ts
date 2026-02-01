/**
 * HTTP Server Implementation
 * Main server with routing for all API endpoints
 */

import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';
import { claudeManager } from '../core/claude-manager.js';
import {
  setCorsHeaders,
  handleCorsPreflightRequest,
  generateRequestId,
  parseJsonBody,
  sendErrorResponse,
  logRequest,
  logResponse,
  requiresAuth,
  validateAuth,
} from './middleware.js';
import { handleHealthCheck, handlePing } from '../handlers/health.js';
import { handleListModels, handleGetModel } from '../handlers/models.js';
import { handleOpenAIChatCompletion } from '../handlers/openai-chat.js';
import { handleAnthropicMessages } from '../handlers/anthropic-messages.js';

/**
 * Server configuration
 */
export interface ServerOptions {
  port: number;
  host: string;
}

/**
 * Route handler type
 */
type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  reqId: string,
  params?: Record<string, string>
) => Promise<void>;

/**
 * Route definition
 */
interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pattern: RegExp;
  handler: RouteHandler;
  paramNames?: string[];
}

/**
 * Define all routes
 */
const routes: Route[] = [
  // Health check
  {
    method: 'GET',
    pattern: /^\/$/,
    handler: async (req, res, body, reqId) => handleHealthCheck(req, res, reqId),
  },
  {
    method: 'GET',
    pattern: /^\/health$/,
    handler: async (req, res, body, reqId) => handleHealthCheck(req, res, reqId),
  },
  {
    method: 'GET',
    pattern: /^\/ping$/,
    handler: async (req, res) => handlePing(req, res),
  },

  // OpenAI Models API
  {
    method: 'GET',
    pattern: /^\/v1\/models$/,
    handler: async (req, res, body, reqId) => handleListModels(req, res, reqId),
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/([^/]+)$/,
    handler: async (req, res, body, reqId, params) =>
      handleGetModel(req, res, params?.modelId || '', reqId),
    paramNames: ['modelId'],
  },

  // OpenAI Chat Completions API
  {
    method: 'POST',
    pattern: /^\/v1\/chat\/completions$/,
    handler: async (req, res, body, reqId) =>
      handleOpenAIChatCompletion(req, res, body as any, reqId),
  },

  // Anthropic Messages API (multiple paths for compatibility)
  {
    method: 'POST',
    pattern: /^\/v1\/messages$/,
    handler: async (req, res, body, reqId) =>
      handleAnthropicMessages(req, res, body as any, reqId),
  },
  {
    method: 'POST',
    pattern: /^\/messages$/,
    handler: async (req, res, body, reqId) =>
      handleAnthropicMessages(req, res, body as any, reqId),
  },
  // Claude Code compatibility path
  {
    method: 'POST',
    pattern: /^\/anthropic\/v1\/messages$/,
    handler: async (req, res, body, reqId) =>
      handleAnthropicMessages(req, res, body as any, reqId),
  },
];

/**
 * Match route and extract parameters
 */
function matchRoute(
  method: string,
  url: string
): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = url.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      if (route.paramNames) {
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1] ?? '';
        });
      }
      return { route, params };
    }
  }
  return null;
}

/**
 * Main request handler
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startTime = Date.now();
  const reqId = generateRequestId();
  const method = req.method || 'GET';
  const url = req.url?.split('?')[0] || '/';

  // Set CORS headers on all responses
  setCorsHeaders(res);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    handleCorsPreflightRequest(res);
    return;
  }

  // Log request
  logRequest(req, reqId);

  try {
    // Match route
    const matched = matchRoute(method, url);

    if (!matched) {
      sendErrorResponse(res, 404, 'not_found_error', `Route not found: ${method} ${url}`);
      logResponse(reqId, 404, startTime);
      return;
    }

    // Check authentication for protected routes
    if (requiresAuth(url)) {
      const authResult = validateAuth(req);
      if (!authResult.valid) {
        sendErrorResponse(res, 401, 'authentication_error', authResult.error || 'Unauthorized');
        logResponse(reqId, 401, startTime);
        return;
      }
    }

    // Parse body for POST/PUT requests
    let body: unknown = {};
    if (method === 'POST' || method === 'PUT') {
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        sendErrorResponse(res, 400, 'invalid_request_error', (err as Error).message);
        logResponse(reqId, 400, startTime);
        return;
      }
    }

    // Execute handler
    await matched.route.handler(req, res, body, reqId, matched.params);

    // Log response (handler already sent response)
    logResponse(reqId, res.statusCode, startTime);
  } catch (err) {
    logger.error('Unhandled error', { reqId, error: (err as Error).message });
    sendErrorResponse(res, 500, 'api_error', 'Internal server error');
    logResponse(reqId, 500, startTime);
  }
}

/**
 * Create and start the server
 */
export function createServer(options: ServerOptions): http.Server {
  const { port, host } = options;

  // Initialize configuration
  config.init();

  const server = http.createServer(handleRequest);

  // Handle server errors
  server.on('error', (err: Error) => {
    logger.error('Server error', { error: err.message });
  });

  // Start listening
  server.listen(port, host, () => {
    logger.info('Server started', {
      host,
      port,
      version: 'v7-modular',
      features: [
        'OpenAI Chat Completions API',
        'OpenAI Models API',
        'Anthropic Messages API',
        'Streaming support',
        'Persistent Claude process',
      ],
    });
  });

  return server;
}

/**
 * Graceful shutdown
 */
export function setupGracefulShutdown(server: http.Server): void {
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);

    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Shutdown Claude process
    claudeManager.shutdown();

    // Exit after timeout
    setTimeout(() => {
      logger.warn('Forced exit after timeout');
      process.exit(0);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

export default {
  createServer,
  setupGracefulShutdown,
};
