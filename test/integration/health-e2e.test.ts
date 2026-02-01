/**
 * End-to-end tests for Health and Models endpoints
 * These tests make real calls to the server but don't require Claude CLI
 *
 * Note: Tests are compatible with both:
 * - Local container server (detailed health, OpenAI aliases)
 * - Cloudflare Workers (simple health, Claude models only)
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
    it('GET /health should return health status', async () => {
      const response = await fetch(`${ctx.baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const body = await response.json();

      // Both versions have status field
      expect(body.status).toBeDefined();
      // Local: 'healthy' or 'degraded', Remote: 'ok'
      expect(['healthy', 'degraded', 'ok']).toContain(body.status);
    });

    // Root endpoint only exists in local container version
    it('GET / should return health status (local only)', async () => {
      if (ctx.isRemote) {
        // Skip for remote - root returns 404 on Cloudflare Workers
        return;
      }

      const response = await fetch(`${ctx.baseUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const body = await response.json();

      expect(['healthy', 'degraded']).toContain(body.status);
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    // Ping endpoint only exists in local container version
    it('GET /ping should return simple ok (local only)', async () => {
      if (ctx.isRemote) {
        // Skip for remote - ping doesn't exist on Cloudflare Workers
        return;
      }

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

      const modelIds = body.data.map((m: any) => m.id);

      // Both versions should have Claude models
      // Check for at least one Claude model (names may vary)
      const hasClaudeModel = modelIds.some((id: string) => id.includes('claude'));
      expect(hasClaudeModel).toBe(true);

      // Check model structure
      const model = body.data[0];
      expect(model.object).toBe('model');
      expect(model.id).toBeDefined();
      expect(model.created).toBeDefined();
      expect(model.owned_by).toBe('anthropic');
    });

    it('GET /v1/models should include OpenAI aliases (local only)', async () => {
      if (ctx.isRemote) {
        // Skip for remote - Cloudflare Workers version doesn't have OpenAI aliases
        return;
      }

      const response = await fetch(`${ctx.baseUrl}/v1/models`);
      const body = await response.json();
      const modelIds = body.data.map((m: any) => m.id);

      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4-turbo');
    });

    it('GET /v1/models/:id should return specific model', async () => {
      // First get the list to find a valid model ID
      const listResponse = await fetch(`${ctx.baseUrl}/v1/models`);
      const listBody = await listResponse.json();
      const firstModelId = listBody.data[0].id;

      const response = await fetch(`${ctx.baseUrl}/v1/models/${firstModelId}`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('model');
      expect(body.id).toBe(firstModelId);
      expect(body.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id with alias should resolve (local only)', async () => {
      if (ctx.isRemote) {
        // Skip for remote - Cloudflare Workers version doesn't have OpenAI aliases
        return;
      }

      const response = await fetch(`${ctx.baseUrl}/v1/models/gpt-4o`);

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.object).toBe('model');
      // Should resolve to a Claude model
      expect(body.id).toContain('claude');
      expect(body.owned_by).toBe('anthropic');
    });

    it('GET /v1/models/:id should return 404 for unknown model', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/models/unknown-model-xyz`);

      expect(response.status).toBe(404);
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
  });
});
