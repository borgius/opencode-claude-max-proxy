/**
 * HTTP Server Middleware
 * CORS, authentication, and common request handling
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

/**
 * CORS configuration
 */
export interface CorsConfig {
  origin: string;
  methods: string[];
  headers: string[];
  credentials?: boolean;
  maxAge?: number;
}

const DEFAULT_CORS: CorsConfig = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  headers: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-OAuth-Creds',
    'Anthropic-Version',
    'X-Request-Id',
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
};

/**
 * Set CORS headers on response
 */
export function setCorsHeaders(res: ServerResponse, corsConfig: CorsConfig = DEFAULT_CORS): void {
  res.setHeader('Access-Control-Allow-Origin', corsConfig.origin);
  res.setHeader('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', corsConfig.headers.join(', '));

  if (corsConfig.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (corsConfig.maxAge) {
    res.setHeader('Access-Control-Max-Age', corsConfig.maxAge.toString());
  }
}

/**
 * Handle CORS preflight request
 */
export function handleCorsPreflightRequest(res: ServerResponse): void {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
}

/**
 * Extract and validate API key from request
 */
export function extractApiKey(req: IncomingMessage): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check X-API-Key header
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string') {
    return apiKey;
  }

  return null;
}

/**
 * Extract OAuth credentials from request header
 */
export function extractOAuthCreds(req: IncomingMessage): boolean {
  const credsHeader = req.headers['x-oauth-creds'];
  if (typeof credsHeader === 'string') {
    return config.updateCredentialsFromHeader(credsHeader);
  }
  return false;
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Parse JSON request body
 */
export async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();

      // Limit body size to 10MB
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON error response
 */
export function sendErrorResponse(
  res: ServerResponse,
  statusCode: number,
  errorType: string,
  message: string
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: {
      type: errorType,
      message,
    },
  }));
}

/**
 * Send Anthropic-format error response
 */
export function sendAnthropicError(
  res: ServerResponse,
  statusCode: number,
  errorType: string,
  message: string
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    type: 'error',
    error: {
      type: errorType,
      message,
    },
  }));
}

/**
 * Middleware wrapper for request logging
 */
export function logRequest(req: IncomingMessage, reqId: string): void {
  logger.info('Request received', {
    reqId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent']?.slice(0, 50),
  });
}

/**
 * Middleware wrapper for response logging
 */
export function logResponse(
  reqId: string,
  statusCode: number,
  startTime: number
): void {
  const duration = Date.now() - startTime;
  logger.info('Response sent', { reqId, statusCode, duration });
}

/**
 * Check if request requires authentication
 */
export function requiresAuth(url: string): boolean {
  // Health check and models list don't require auth
  if (url === '/' || url === '/health' || url === '/ping') {
    return false;
  }
  if (url === '/v1/models' || url?.startsWith('/v1/models/')) {
    return false;
  }
  return true;
}

/**
 * Validate authentication for request
 */
export function validateAuth(req: IncomingMessage): {
  valid: boolean;
  error?: string;
} {
  // Try to extract OAuth creds from header first
  extractOAuthCreds(req);

  // Check if we have valid credentials
  if (!config.hasValidCredentials()) {
    return { valid: false, error: 'No valid OAuth credentials configured' };
  }

  return { valid: true };
}

export const middleware = {
  setCorsHeaders,
  handleCorsPreflightRequest,
  extractApiKey,
  extractOAuthCreds,
  generateRequestId,
  parseJsonBody,
  sendErrorResponse,
  sendAnthropicError,
  logRequest,
  logResponse,
  requiresAuth,
  validateAuth,
  DEFAULT_CORS,
};

export default middleware;
