/**
 * Tests for OpenAI Chat Completions API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockResponse,
  waitForResponse,
  parseSSEEvents,
  createMockClaudeManager,
} from './setup.js';
import type { ClaudeStreamMessage } from '../src/core/types.js';

// Mock claude-manager - must use factory function without external references
vi.mock('../src/core/claude-manager.js', () => {
  return {
    claudeManager: {
      sendMessage: vi.fn(),
      getStatus: vi.fn(() => ({
        alive: true,
        requestCount: 1,
        queueLength: 0,
        lastActivity: Date.now(),
        pid: 12345,
      })),
      shutdown: vi.fn(),
      ensureProcess: vi.fn(),
    },
  };
});

// Mock config
vi.mock('../src/core/config.js', () => ({
  config: {
    hasValidCredentials: vi.fn(() => true),
    getCredentials: vi.fn(() => ({
      accessToken: 'test-token',
      subscriptionType: 'claude_max',
    })),
    init: vi.fn(),
  },
}));

// Import after mocks
import { claudeManager } from '../src/core/claude-manager.js';
import {
  handleOpenAIChatCompletion,
  validateRequest,
  supportedParameters,
} from '../src/handlers/openai-chat.js';

describe('OpenAI Chat Completions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Request Validation', () => {
    it('should reject empty body', () => {
      const result = validateRequest(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('JSON object');
    });

    it('should reject missing messages', () => {
      const result = validateRequest({ model: 'gpt-4o' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('messages');
    });

    it('should reject empty messages array', () => {
      const result = validateRequest({ model: 'gpt-4o', messages: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject missing model', () => {
      const result = validateRequest({
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('model');
    });

    it('should accept valid request', () => {
      const result = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.valid).toBe(true);
      expect(result.request).toBeDefined();
    });

    it('should validate temperature range', () => {
      const tooLow = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: -1,
      });
      expect(tooLow.valid).toBe(false);

      const tooHigh = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 3,
      });
      expect(tooHigh.valid).toBe(false);

      const valid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      });
      expect(valid.valid).toBe(true);
    });

    it('should validate top_p range', () => {
      const invalid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        top_p: 1.5,
      });
      expect(invalid.valid).toBe(false);

      const valid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        top_p: 0.9,
      });
      expect(valid.valid).toBe(true);
    });

    it('should validate n parameter', () => {
      const invalid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        n: 0,
      });
      expect(invalid.valid).toBe(false);

      const valid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        n: 2,
      });
      expect(valid.valid).toBe(true);
    });

    it('should validate frequency_penalty range', () => {
      const invalid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        frequency_penalty: 3,
      });
      expect(invalid.valid).toBe(false);

      const valid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        frequency_penalty: 0.5,
      });
      expect(valid.valid).toBe(true);
    });

    it('should validate max_tokens is a number', () => {
      const invalid = validateRequest({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 'invalid',
      });
      expect(invalid.valid).toBe(false);
    });
  });

  describe('Non-Streaming Response', () => {
    it('should return complete chat completion response', async () => {
      // Setup mock implementation
      vi.mocked(claudeManager.sendMessage).mockImplementation((
        prompt: string,
        onEvent: (msg: ClaudeStreamMessage) => void,
        onError: (err: Error) => void,
        onDone: (code: number) => void
      ) => {
        onEvent({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from Claude!' }],
          },
        });
        onEvent({
          type: 'result',
          usage: { input_tokens: 10, output_tokens: 5 },
        });
        setTimeout(() => onDone(0), 1);
      });

      const res = createMockResponse();

      await handleOpenAIChatCompletion({} as any, res, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }, 'test-req-1');

      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('application/json');

      const body = JSON.parse(res._body);
      expect(body.object).toBe('chat.completion');
      expect(body.id).toMatch(/^chatcmpl-/);
      expect(body.model).toBe('gpt-4o');
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].message.role).toBe('assistant');
      expect(body.choices[0].message.content).toBe('Hello from Claude!');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.usage).toBeDefined();
    });

    it('should handle invalid request body', async () => {
      const res = createMockResponse();

      await handleOpenAIChatCompletion({} as any, res, {
        model: 'gpt-4o',
        // Missing messages
      } as any, 'test-req-2');

      expect(res._statusCode).toBe(400);

      const body = JSON.parse(res._body);
      expect(body.error.type).toBe('invalid_request_error');
    });
  });

  describe('Streaming Response', () => {
    it('should return SSE stream with correct events', async () => {
      // Setup streaming mock
      const streamEvents = createMockClaudeManager('Hello from Claude!');
      vi.mocked(claudeManager.sendMessage).mockImplementation(streamEvents.sendMessage);

      const res = createMockResponse();

      await handleOpenAIChatCompletion({} as any, res, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, 'test-req-3');

      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('text/event-stream');
      expect(res._headers['cache-control']).toBe('no-cache, no-transform');

      const events = parseSSEEvents(res._body);

      // Should have events
      expect(events.length).toBeGreaterThan(0);

      // Last event should be [DONE]
      expect(events[events.length - 1].data).toBe('[DONE]');
    });

    it('should return chunks with correct structure', async () => {
      const streamEvents = createMockClaudeManager('Test');
      vi.mocked(claudeManager.sendMessage).mockImplementation(streamEvents.sendMessage);

      const res = createMockResponse();

      await handleOpenAIChatCompletion({} as any, res, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }, 'test-req-5');

      await waitForResponse(res);

      const events = parseSSEEvents(res._body);
      const dataEvents = events.filter(e =>
        typeof e.data === 'object' && e.data !== null && 'id' in (e.data as any)
      );

      expect(dataEvents.length).toBeGreaterThan(0);

      for (const event of dataEvents) {
        const chunk = event.data as any;
        expect(chunk.object).toBe('chat.completion.chunk');
        expect(chunk.id).toMatch(/^chatcmpl-/);
        expect(chunk.model).toBe('gpt-4o');
      }
    });
  });

  describe('Supported Parameters', () => {
    it('should list required parameters', () => {
      expect(supportedParameters.required).toContain('model');
      expect(supportedParameters.required).toContain('messages');
    });

    it('should list supported parameters', () => {
      expect(supportedParameters.supported).toContain('stream');
      expect(supportedParameters.supported).toContain('temperature');
      expect(supportedParameters.supported).toContain('max_tokens');
      expect(supportedParameters.supported).toContain('tools');
      expect(supportedParameters.supported).toContain('response_format');
      expect(supportedParameters.supported).toContain('reasoning_effort');
    });

    it('should identify passthrough parameters', () => {
      expect(supportedParameters.passthrough).toContain('frequency_penalty');
      expect(supportedParameters.passthrough).toContain('presence_penalty');
      expect(supportedParameters.passthrough).toContain('seed');
    });
  });

  describe('Error Handling', () => {
    it('should handle Claude manager errors', async () => {
      vi.mocked(claudeManager.sendMessage).mockImplementation((
        prompt: string,
        onEvent: (msg: any) => void,
        onError: (err: Error) => void,
        onDone: (code: number) => void
      ) => {
        setTimeout(() => {
          onError(new Error('Claude process failed'));
        }, 1);
      });

      const res = createMockResponse();

      await handleOpenAIChatCompletion({} as any, res, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }, 'test-req-8');

      await waitForResponse(res);

      expect(res._statusCode).toBe(500);

      const body = JSON.parse(res._body);
      expect(body.error.type).toBe('api_error');
      expect(body.error.message).toContain('Claude process failed');
    });

    it('should handle streaming errors gracefully', async () => {
      vi.mocked(claudeManager.sendMessage).mockImplementation((
        prompt: string,
        onEvent: (msg: any) => void,
        onError: (err: Error) => void,
        onDone: (code: number) => void
      ) => {
        setTimeout(() => {
          onError(new Error('Stream interrupted'));
        }, 1);
      });

      const res = createMockResponse();

      await handleOpenAIChatCompletion({} as any, res, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, 'test-req-9');

      await waitForResponse(res);

      expect(res._body).toContain('error');
      expect(res._body).toContain('Stream interrupted');
    });
  });
});
