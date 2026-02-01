/**
 * End-to-end tests for Health and Models endpoints
 * These tests make real calls to the server
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

// Import actual implementations (no mocking)
import { handleRequest } from '../../src/server/server.js';
import { claudeManager } from '../../src/core/claude-manager.js';

describe('Health and Models E2E', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Create a test server
    server = createServer(async (req, res) => {
      await handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    // Close server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    // Shutdown Claude process if it was started
    claudeManager.shutdown();
  });

  describe('Health Endpoints', () => {
    it('GET / should return health status', async () => {
      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const body = await response.json();

      expect(body.status).toBe('healthy');
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.credentials).toBeDefined();
      expect(body.process).toBeDefined();
      expect(body.endpoints).toBeDefined();
    });

    it('GET /health should return detailed health info', async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.status).toBe('healthy');
      expect(body.version).toBe('v7-modular');
      expect(body.endpoints.openai).toContain('POST /v1/chat/completions');
      expect(body.endpoints.anthropic).toContain('POST /v1/messages');
    });

    it('GET /ping should return simple ok', async () => {
      const response = await fetch(`${baseUrl}/ping`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('Models Endpoints', () => {
    it('GET /v1/models should return list of models', async () => {
      const response = await fetch(`${baseUrl}/v1/models`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('list');
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);

      // Check for expected models
      const modelIds = body.data.map((m: any) => m.id);
      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4-turbo');
      expect(modelIds).toContain('claude-sonnet-4-20250514');
      expect(modelIds).toContain('claude-3-5-sonnet-20241022');

      // Check model structure
      const model = body.data[0];
      expect(model.object).toBe('model');
      expect(model.id).toBeDefined();
      expect(model.created).toBeDefined();
      expect(model.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id should return specific model', async () => {
      const response = await fetch(`${baseUrl}/v1/models/gpt-4o`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('model');
      expect(body.id).toBe('gpt-4o');
      expect(body.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id should return 404 for unknown model', async () => {
      const response = await fetch(`${baseUrl}/v1/models/unknown-model-xyz`);

      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('OPTIONS should return CORS headers', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${baseUrl}/unknown/path`);

      expect(response.status).toBe(404);
    });

    it('should return 405 for wrong method', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
    });
  });
});
