/**
 * End-to-end tests for Health and Models endpoints
 * These tests make real calls to the server but don't require Claude CLI
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer, type TestServerContext } from './test-server.js';

describe('Health and Models E2E', () => {
  let ctx: TestServerContext;

  beforeAll(async () => {
    // Create test server WITHOUT starting Claude process
    // Health/models endpoints don't need it
    ctx = await createTestServer(false);
  }, 30000);

  afterAll(async () => {
    // Close server without shutting down Claude (we didn't start it)
    await closeTestServer(ctx, false);
  });

  describe('Health Endpoints', () => {
    it('GET / should return health status', async () => {
      const response = await fetch(`${ctx.baseUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const body = await response.json();

      // Status can be 'healthy' or 'degraded' depending on Claude process state
      expect(['healthy', 'degraded']).toContain(body.status);
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.credentials).toBeDefined();
      expect(body.process).toBeDefined();
      expect(body.endpoints).toBeDefined();
    });

    it('GET /health should return detailed health info', async () => {
      const response = await fetch(`${ctx.baseUrl}/health`);

      expect(response.status).toBe(200);

      const body = await response.json();

      // Status can be 'healthy' or 'degraded' depending on Claude process state
      expect(['healthy', 'degraded']).toContain(body.status);
      expect(body.version).toBe('v7-modular');
      expect(body.endpoints.openai).toContain('POST /v1/chat/completions');
      expect(body.endpoints.anthropic).toContain('POST /v1/messages');
    });

    it('GET /ping should return simple ok', async () => {
      const response = await fetch(`${ctx.baseUrl}/ping`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('Models Endpoints', () => {
    it('GET /v1/models should return list of models', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/models`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('list');
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);

      // Check for expected models (current Claude models + OpenAI aliases)
      const modelIds = body.data.map((m: any) => m.id);
      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4-turbo');
      // Use actual Claude model IDs
      expect(modelIds).toContain('claude-sonnet-4-5-20250929');
      expect(modelIds).toContain('claude-opus-4-5-20251101');

      // Check model structure
      const model = body.data[0];
      expect(model.object).toBe('model');
      expect(model.id).toBeDefined();
      expect(model.created).toBeDefined();
      expect(model.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id should return specific model', async () => {
      // Request a Claude model directly
      const response = await fetch(`${ctx.baseUrl}/v1/models/claude-sonnet-4-5-20250929`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('model');
      expect(body.id).toBe('claude-sonnet-4-5-20250929');
      expect(body.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id with alias should return resolved model', async () => {
      // Request using OpenAI alias - should return resolved Claude model
      const response = await fetch(`${ctx.baseUrl}/v1/models/gpt-4o`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('model');
      // gpt-4o resolves to claude-sonnet-4-5-20250929
      expect(body.id).toBe('claude-sonnet-4-5-20250929');
      expect(body.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id should return 404 for unknown model', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/models/unknown-model-xyz`);

      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('OPTIONS should return CORS headers', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/chat/completions`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${ctx.baseUrl}/unknown/path`);

      expect(response.status).toBe(404);
    });

    it('should return 404 for wrong method on existing route', async () => {
      // Current implementation returns 404 for method mismatch
      // (could be enhanced to return 405 in the future)
      const response = await fetch(`${ctx.baseUrl}/v1/chat/completions`, {
        method: 'GET',
      });

      expect(response.status).toBe(404);
    });
  });
});
