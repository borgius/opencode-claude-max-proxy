/**
 * Tests for models API endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockRequest, createMockResponse, waitForResponse } from './setup.js';
import {
  handleListModels,
  handleGetModel,
  getModels,
  getModel,
  resolveModelId,
  MODEL_ALIASES,
  CLAUDE_MODELS,
  DEFAULT_MODEL,
} from '../src/handlers/models.js';

describe('Models Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /v1/models', () => {
    it('should return list of available models', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models' });
      const res = createMockResponse();

      await handleListModels(req, res, 'test-req-1');
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('application/json');

      const body = JSON.parse(res._body);
      expect(body.object).toBe('list');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should include Claude 4.5 models (supported by Claude Code)', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models' });
      const res = createMockResponse();

      await handleListModels(req, res, 'test-req-2');
      await waitForResponse(res);

      const body = JSON.parse(res._body);
      const modelIds = body.data.map((m: { id: string }) => m.id);

      expect(modelIds).toContain(CLAUDE_MODELS.OPUS);
      expect(modelIds).toContain(CLAUDE_MODELS.SONNET);
      expect(modelIds).toContain(CLAUDE_MODELS.HAIKU);
    });

    it('should include OpenAI-style alias models', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models' });
      const res = createMockResponse();

      await handleListModels(req, res, 'test-req-3');
      await waitForResponse(res);

      const body = JSON.parse(res._body);
      const modelIds = body.data.map((m: { id: string }) => m.id);

      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4o-mini');
      expect(modelIds).toContain('gpt-4-turbo');
    });

    it('should return models with correct structure', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models' });
      const res = createMockResponse();

      await handleListModels(req, res, 'test-req-4');
      await waitForResponse(res);

      const body = JSON.parse(res._body);
      const model = body.data[0];

      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('object');
      expect(model).toHaveProperty('created');
      expect(model).toHaveProperty('owned_by');
      expect(model.object).toBe('model');
      expect(model.owned_by).toBe('anthropic');
    });
  });

  describe('GET /v1/models/:id', () => {
    it('should return specific model by ID', async () => {
      const req = createMockRequest({ method: 'GET', url: `/v1/models/${CLAUDE_MODELS.SONNET}` });
      const res = createMockResponse();

      await handleGetModel(req, res, CLAUDE_MODELS.SONNET, 'test-req-5');
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);

      const body = JSON.parse(res._body);
      expect(body.id).toBe(CLAUDE_MODELS.SONNET);
      expect(body.object).toBe('model');
      expect(body.owned_by).toBe('anthropic');
    });

    it('should return 404 for unknown model', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models/unknown-model' });
      const res = createMockResponse();

      await handleGetModel(req, res, 'unknown-model', 'test-req-6');
      await waitForResponse(res);

      expect(res._statusCode).toBe(404);

      const body = JSON.parse(res._body);
      expect(body.error.type).toBe('invalid_request_error');
      expect(body.error.code).toBe('model_not_found');
      expect(body.error.message).toContain('unknown-model');
    });

    it('should resolve model aliases', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models/gpt-4o' });
      const res = createMockResponse();

      await handleGetModel(req, res, 'gpt-4o', 'test-req-7');
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);

      const body = JSON.parse(res._body);
      // gpt-4o should resolve to claude-sonnet-4.5
      expect(body.id).toBe(CLAUDE_MODELS.SONNET);
    });
  });

  describe('getModels', () => {
    it('should return models response object', () => {
      const response = getModels();

      expect(response.object).toBe('list');
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);
    });
  });

  describe('getModel', () => {
    it('should return model by exact ID', () => {
      const model = getModel(CLAUDE_MODELS.OPUS);

      expect(model).not.toBeNull();
      expect(model?.id).toBe(CLAUDE_MODELS.OPUS);
    });

    it('should return null for unknown model', () => {
      const model = getModel('nonexistent-model');

      expect(model).toBeNull();
    });

    it('should resolve aliases', () => {
      const model = getModel('claude-3.5-sonnet');

      expect(model).not.toBeNull();
      expect(model?.id).toBe(CLAUDE_MODELS.SONNET);
    });
  });

  describe('resolveModelId', () => {
    it('should resolve OpenAI aliases to Claude models', () => {
      expect(resolveModelId('gpt-4o')).toBe(CLAUDE_MODELS.SONNET);
      expect(resolveModelId('gpt-4o-mini')).toBe(CLAUDE_MODELS.HAIKU);
      expect(resolveModelId('gpt-4')).toBe(CLAUDE_MODELS.OPUS);
      expect(resolveModelId('gpt-3.5-turbo')).toBe(CLAUDE_MODELS.HAIKU);
      expect(resolveModelId('o1')).toBe(CLAUDE_MODELS.OPUS);
      expect(resolveModelId('o1-mini')).toBe(CLAUDE_MODELS.HAIKU);
    });

    it('should pass through supported Claude models', () => {
      expect(resolveModelId(CLAUDE_MODELS.OPUS)).toBe(CLAUDE_MODELS.OPUS);
      expect(resolveModelId(CLAUDE_MODELS.SONNET)).toBe(CLAUDE_MODELS.SONNET);
      expect(resolveModelId(CLAUDE_MODELS.HAIKU)).toBe(CLAUDE_MODELS.HAIKU);
    });

    it('should map old Claude models to new ones', () => {
      expect(resolveModelId('claude-3-5-sonnet-20241022')).toBe(CLAUDE_MODELS.SONNET);
      expect(resolveModelId('claude-3-5-haiku-20241022')).toBe(CLAUDE_MODELS.HAIKU);
      expect(resolveModelId('claude-3-opus-20240229')).toBe(CLAUDE_MODELS.OPUS);
    });

    it('should default unknown models to Sonnet', () => {
      expect(resolveModelId('custom-model')).toBe(DEFAULT_MODEL);
      expect(resolveModelId('unknown-xyz')).toBe(DEFAULT_MODEL);
    });
  });

  describe('MODEL_ALIASES', () => {
    it('should have short aliases', () => {
      expect(MODEL_ALIASES['claude-4']).toBe(CLAUDE_MODELS.SONNET);
      expect(MODEL_ALIASES['claude-4.5']).toBe(CLAUDE_MODELS.SONNET);
      expect(MODEL_ALIASES['claude-4.5-opus']).toBe(CLAUDE_MODELS.OPUS);
    });

    it('should have OpenAI compatibility aliases', () => {
      expect(MODEL_ALIASES['gpt-4o']).toBe(CLAUDE_MODELS.SONNET);
      expect(MODEL_ALIASES['gpt-4']).toBe(CLAUDE_MODELS.OPUS);
      expect(MODEL_ALIASES['gpt-4-turbo']).toBe(CLAUDE_MODELS.SONNET);
      expect(MODEL_ALIASES['gpt-3.5-turbo']).toBe(CLAUDE_MODELS.HAIKU);
    });
  });

  describe('CLAUDE_MODELS constants', () => {
    it('should have correct model IDs', () => {
      expect(CLAUDE_MODELS.OPUS).toBe('claude-opus-4-5-20251101');
      expect(CLAUDE_MODELS.SONNET).toBe('claude-sonnet-4-5-20250929');
      expect(CLAUDE_MODELS.HAIKU).toBe('claude-haiku-4-5-20251001');
    });

    it('should have Sonnet as default', () => {
      expect(DEFAULT_MODEL).toBe(CLAUDE_MODELS.SONNET);
    });
  });
});
