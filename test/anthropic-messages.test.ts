/**
 * Tests for Anthropic Messages API
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
  handleAnthropicMessages,
  validateRequest,
  supportedParameters,
} from '../src/handlers/anthropic-messages.js';

describe('Anthropic Messages API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Request Validation', () => {
    it('should reject empty body', () => {
      const result = validateRequest(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('JSON object');
    });

    it('should reject missing model', () => {
      const result = validateRequest({
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('model');
    });

    it('should reject missing messages', () => {
      const result = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('messages');
    });

    it('should reject missing max_tokens', () => {
      const result = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('max_tokens');
    });

    it('should reject empty messages array', () => {
      const result = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [],
        max_tokens: 1000,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should accept valid request', () => {
      const result = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
      });
      expect(result.valid).toBe(true);
      expect(result.request).toBeDefined();
    });

    it('should validate temperature range (0-1 for Anthropic)', () => {
      const tooHigh = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        temperature: 1.5,
      });
      expect(tooHigh.valid).toBe(false);

      const valid = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        temperature: 0.7,
      });
      expect(valid.valid).toBe(true);
    });

    it('should validate top_p range', () => {
      const invalid = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        top_p: 1.5,
      });
      expect(invalid.valid).toBe(false);
    });

    it('should validate top_k is non-negative', () => {
      const invalid = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        top_k: -5,
      });
      expect(invalid.valid).toBe(false);

      const valid = validateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        top_k: 40,
      });
      expect(valid.valid).toBe(true);
    });
  });

  describe('Non-Streaming Response', () => {
    it('should return complete message response', async () => {
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

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        stream: false,
      }, 'test-req-1');

      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('application/json');

      const body = JSON.parse(res._body);
      expect(body.type).toBe('message');
      expect(body.id).toMatch(/^msg-/);
      expect(body.role).toBe('assistant');
      expect(body.model).toBe('claude-3-5-sonnet-20241022');
      expect(body.content).toHaveLength(1);
      expect(body.content[0].type).toBe('text');
      expect(body.content[0].text).toBe('Hello from Claude!');
      expect(body.stop_reason).toBe('end_turn');
      expect(body.usage).toBeDefined();
    });

    it('should handle invalid request', async () => {
      const res = createMockResponse();

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        // Missing messages and max_tokens
      } as any, 'test-req-4');

      expect(res._statusCode).toBe(400);

      const body = JSON.parse(res._body);
      expect(body.type).toBe('error');
      expect(body.error.type).toBe('invalid_request_error');
    });
  });

  describe('Streaming Response', () => {
    it('should return SSE stream with Anthropic event format', async () => {
      const streamEvents = createMockClaudeManager('Hello from Claude!');
      vi.mocked(claudeManager.sendMessage).mockImplementation(streamEvents.sendMessage);

      const res = createMockResponse();

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        stream: true,
      }, 'test-req-5');

      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect(res._headers['content-type']).toBe('text/event-stream');
      expect(res._headers['cache-control']).toBe('no-cache, no-transform');

      const events = parseSSEEvents(res._body);
      expect(events.length).toBeGreaterThan(0);

      // Should have message_start event
      const messageStart = events.find(e => e.event === 'message_start');
      expect(messageStart).toBeDefined();
      expect((messageStart?.data as any)?.type).toBe('message_start');

      // Should have message_stop
      const messageStop = events.find(e => e.event === 'message_stop');
      expect(messageStop).toBeDefined();
    });

    it('should include correct event sequence', async () => {
      const streamEvents = createMockClaudeManager('Test');
      vi.mocked(claudeManager.sendMessage).mockImplementation(streamEvents.sendMessage);

      const res = createMockResponse();

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1000,
        stream: true,
      }, 'test-req-6');

      await waitForResponse(res);

      const events = parseSSEEvents(res._body);
      const eventTypes = events
        .filter(e => e.event)
        .map(e => e.event);

      // Check event types exist
      expect(eventTypes).toContain('message_start');
      expect(eventTypes).toContain('message_stop');

      // message_start should come first
      expect(eventTypes.indexOf('message_start')).toBe(0);

      // message_stop should come last
      expect(eventTypes.indexOf('message_stop')).toBe(eventTypes.length - 1);
    });

    it('should include model and ID in message_start', async () => {
      const streamEvents = createMockClaudeManager('Test');
      vi.mocked(claudeManager.sendMessage).mockImplementation(streamEvents.sendMessage);

      const res = createMockResponse();

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1000,
        stream: true,
      }, 'test-req-7');

      await waitForResponse(res);

      const events = parseSSEEvents(res._body);
      const messageStart = events.find(e => e.event === 'message_start');

      expect(messageStart).toBeDefined();
      const data = messageStart?.data as any;
      expect(data.message.id).toMatch(/^msg-/);
      expect(data.message.model).toBe('claude-3-5-sonnet-20241022');
      expect(data.message.role).toBe('assistant');
    });
  });

  describe('Error Handling', () => {
    it('should handle Claude manager errors in non-streaming', async () => {
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

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        stream: false,
      }, 'test-req-11');

      await waitForResponse(res);

      expect(res._statusCode).toBe(500);

      const body = JSON.parse(res._body);
      expect(body.type).toBe('error');
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

      await handleAnthropicMessages({} as any, res, {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1000,
        stream: true,
      }, 'test-req-12');

      await waitForResponse(res);

      const events = parseSSEEvents(res._body);
      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
    });
  });

  describe('Supported Parameters', () => {
    it('should list required parameters', () => {
      expect(supportedParameters.required).toContain('model');
      expect(supportedParameters.required).toContain('messages');
      expect(supportedParameters.required).toContain('max_tokens');
    });

    it('should list supported parameters', () => {
      expect(supportedParameters.supported).toContain('stream');
      expect(supportedParameters.supported).toContain('system');
      expect(supportedParameters.supported).toContain('temperature');
      expect(supportedParameters.supported).toContain('top_p');
      expect(supportedParameters.supported).toContain('top_k');
      expect(supportedParameters.supported).toContain('stop_sequences');
      expect(supportedParameters.supported).toContain('tools');
    });
  });
});
