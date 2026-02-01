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

    it('should include Claude 4 models', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models' });
      const res = createMockResponse();

      await handleListModels(req, res, 'test-req-2');
      await waitForResponse(res);

      const body = JSON.parse(res._body);
      const modelIds = body.data.map((m: { id: string }) => m.id);

      expect(modelIds).toContain('claude-opus-4-20250514');
      expect(modelIds).toContain('claude-sonnet-4-20250514');
    });

    it('should include Claude 3.5 models', async () => {
      const req = createMockRequest({ method: 'GET', url: '/v1/models' });
      const res = createMockResponse();

      await handleListModels(req, res, 'test-req-3');
      await waitForResponse(res);

      const body = JSON.parse(res._body);
      const modelIds = body.data.map((m: { id: string }) => m.id);

      expect(modelIds).toContain('claude-3-5-sonnet-20241022');
      expect(modelIds).toContain('claude-3-5-haiku-20241022');
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
      const req = createMockRequest({ method: 'GET', url: '/v1/models/claude-sonnet-4-20250514' });
      const res = createMockResponse();

      await handleGetModel(req, res, 'claude-sonnet-4-20250514', 'test-req-5');
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);

      const body = JSON.parse(res._body);
      expect(body.id).toBe('claude-sonnet-4-20250514');
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
      // gpt-4o should resolve to claude-sonnet-4
      expect(body.id).toBe('claude-sonnet-4-20250514');
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
      const model = getModel('claude-3-opus-20240229');

      expect(model).not.toBeNull();
      expect(model?.id).toBe('claude-3-opus-20240229');
    });

    it('should return null for unknown model', () => {
      const model = getModel('nonexistent-model');

      expect(model).toBeNull();
    });

    it('should resolve aliases', () => {
      const model = getModel('claude-3.5-sonnet');

      expect(model).not.toBeNull();
      expect(model?.id).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('resolveModelId', () => {
    it('should resolve known aliases', () => {
      expect(resolveModelId('gpt-4o')).toBe('claude-sonnet-4-20250514');
      expect(resolveModelId('gpt-4')).toBe('claude-3-opus-20240229');
      expect(resolveModelId('gpt-3.5-turbo')).toBe('claude-3-haiku-20240307');
    });

    it('should pass through unknown model IDs', () => {
      expect(resolveModelId('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
      expect(resolveModelId('custom-model')).toBe('custom-model');
    });
  });

  describe('MODEL_ALIASES', () => {
    it('should have short aliases', () => {
      expect(MODEL_ALIASES['claude-4']).toBeDefined();
      expect(MODEL_ALIASES['claude-3.5-sonnet']).toBeDefined();
    });

    it('should have OpenAI compatibility aliases', () => {
      expect(MODEL_ALIASES['gpt-4o']).toBeDefined();
      expect(MODEL_ALIASES['gpt-4']).toBeDefined();
      expect(MODEL_ALIASES['gpt-4-turbo']).toBeDefined();
    });
  });
});
