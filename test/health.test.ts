/**
 * Tests for health check endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse, waitForResponse } from './setup.js';

// Mock the claude-manager module
vi.mock('../src/core/claude-manager.js', () => ({
  claudeManager: {
    getStatus: vi.fn(() => ({
      alive: true,
      requestCount: 5,
      queueLength: 0,
      lastActivity: Date.now(),
      pid: 12345,
    })),
    shutdown: vi.fn(),
  },
}));

// Mock config
vi.mock('../src/core/config.js', () => ({
  config: {
    hasValidCredentials: vi.fn(() => true),
    getCredentials: vi.fn(() => ({
      accessToken: 'test-token',
      subscriptionType: 'claude_max',
    })),
    init: vi.fn(),
    getServerConfig: vi.fn(() => ({
      port: 8080,
      host: '0.0.0.0',
      logLevel: 'INFO',
    })),
  },
}));

import { handleHealthCheck, handlePing, getHealthStatus } from '../src/handlers/health.js';

describe('Health Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy status with process info', async () => {
      const req = createMockRequest({ method: 'GET', url: '/health' });
      const res = createMockResponse();

      await handleHealthCheck(req, res, 'test-req-1');
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('application/json');

      const body = JSON.parse(res._body);
      expect(body.status).toBe('healthy');
      expect(body.version).toBe('v7-modular');
      expect(body.credentials.configured).toBe(true);
      expect(body.credentials.subscriptionType).toBe('claude_max');
      expect(body.process.alive).toBe(true);
      expect(body.process.requestCount).toBe(5);
      expect(body.endpoints.openai).toContain('POST /v1/chat/completions');
      expect(body.endpoints.anthropic).toContain('POST /v1/messages');
    });

    it('should include timestamp in ISO format', async () => {
      const req = createMockRequest({ method: 'GET', url: '/health' });
      const res = createMockResponse();

      await handleHealthCheck(req, res, 'test-req-2');
      await waitForResponse(res);

      const body = JSON.parse(res._body);
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('GET /ping', () => {
    it('should return simple ok status', async () => {
      const req = createMockRequest({ method: 'GET', url: '/ping' });
      const res = createMockResponse();

      await handlePing(req, res);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('application/json');

      const body = JSON.parse(res._body);
      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('getHealthStatus', () => {
    it('should return complete health status object', async () => {
      const status = await getHealthStatus();

      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('version');
      expect(status).toHaveProperty('timestamp');
      expect(status).toHaveProperty('credentials');
      expect(status).toHaveProperty('process');
      expect(status).toHaveProperty('endpoints');

      expect(status.credentials).toHaveProperty('configured');
      expect(status.process).toHaveProperty('alive');
      expect(status.process).toHaveProperty('requestCount');
    });
  });
});
