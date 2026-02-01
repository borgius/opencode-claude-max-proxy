/**
 * Health Check Handler
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { claudeManager } from '../core/claude-manager.js';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

/**
 * Health check response structure
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  credentials: {
    configured: boolean;
    subscriptionType?: string;
  };
  process: {
    alive: boolean;
    requestCount: number;
    queueLength: number;
    pid?: number;
  };
  endpoints: {
    openai: string[];
    anthropic: string[];
  };
}

/**
 * Get current health status
 */
export function getHealthStatus(): HealthResponse {
  const creds = config.getCredentials();
  const processStatus = claudeManager.getStatus();

  return {
    status: processStatus.alive ? 'healthy' : 'degraded',
    version: 'v7-modular',
    timestamp: new Date().toISOString(),
    credentials: {
      configured: config.hasValidCredentials(),
      subscriptionType: creds?.subscriptionType,
    },
    process: {
      alive: processStatus.alive,
      requestCount: processStatus.requestCount,
      queueLength: processStatus.queueLength,
      pid: processStatus.pid,
    },
    endpoints: {
      openai: [
        'GET /v1/models',
        'GET /v1/models/:id',
        'POST /v1/chat/completions',
        'POST /v1/responses',
      ],
      anthropic: [
        'POST /v1/messages',
      ],
    },
  };
}

/**
 * Handle GET /health or GET /
 */
export async function handleHealthCheck(
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string
): Promise<void> {
  logger.debug('Health check request', { reqId });

  const health = getHealthStatus();
  const statusCode = health.status === 'unhealthy' ? 503 : 200;

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(health));
}

/**
 * Handle simple ping (minimal response)
 */
export async function handlePing(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

export default {
  handleHealthCheck,
  handlePing,
  getHealthStatus,
};
