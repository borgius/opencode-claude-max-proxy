/**
 * End-to-end tests for Anthropic Messages API
 * These tests make real calls to the Claude CLI
 *
 * Note: Tests that require real Claude API access will be skipped
 * unless valid credentials are configured (not 'test-token')
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, closeTestServer, type TestServerContext } from './test-server.js';

describe('Anthropic Messages E2E', () => {
  let ctx: TestServerContext;

  beforeAll(async () => {
    // Create test server WITH Claude process for messages API
    ctx = await createTestServer(true);
  }, 60000);

  afterAll(async () => {
    // Close server and shutdown Claude process
    await closeTestServer(ctx, true);
  });

  describe('Non-Streaming', () => {
    it('should return a complete message response from Claude', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
          max_tokens: 50,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const body = await response.json();

      expect(body.type).toBe('message');
      expect(body.id).toMatch(/^msg-/);
      expect(body.role).toBe('assistant');
      // Model may be the requested model or resolved model
      expect(body.model).toBeDefined();
      expect(body.content).toHaveLength(1);
      expect(body.content[0].type).toBe('text');
      expect(body.content[0].text).toBeTruthy();
      expect(body.content[0].text.toLowerCase()).toContain('hello');
      expect(body.stop_reason).toBe('end_turn');
      expect(body.usage).toBeDefined();
      expect(body.usage.input_tokens).toBeGreaterThan(0);
      expect(body.usage.output_tokens).toBeGreaterThan(0);
    }, 60000);

    it('should handle system parameter', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          system: 'You are a helpful assistant.',
          messages: [{ role: 'user', content: 'Say hello in exactly 3 words.' }],
          max_tokens: 50,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.json();

      // Verify response structure
      expect(body.type).toBe('message');
      expect(body.role).toBe('assistant');
      expect(body.content[0].text).toBeTruthy();
      expect(body.stop_reason).toBe('end_turn');
    }, 60000);

    it('should work with /messages alias', async () => {
      const response = await fetch(`${ctx.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
          max_tokens: 10,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.content[0].text).toContain('4');
    }, 60000);

    it('should work with /anthropic/v1/messages path', async () => {
      const response = await fetch(`${ctx.baseUrl}/anthropic/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Say "test" and nothing else.' }],
          max_tokens: 10,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.type).toBe('message');
      expect(body.content[0].text.toLowerCase()).toContain('test');
    }, 60000);
  });

  describe('Streaming', () => {
    it('should stream SSE events with Anthropic format', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
          max_tokens: 50,
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      const text = await response.text();
      const lines = text.split('\n');

      // Parse events
      const events: Array<{ event: string; data: any }> = [];
      let currentEvent = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            events.push({ event: currentEvent, data: JSON.parse(data) });
          } catch {
            events.push({ event: currentEvent, data });
          }
        }
      }

      // Check for message_start
      const messageStart = events.find((e) => e.event === 'message_start');
      expect(messageStart).toBeDefined();
      expect(messageStart?.data.type).toBe('message_start');
      expect(messageStart?.data.message.id).toMatch(/^msg-/);
      expect(messageStart?.data.message.role).toBe('assistant');

      // Check for message_stop
      const messageStop = events.find((e) => e.event === 'message_stop');
      expect(messageStop).toBeDefined();

      // Check for content deltas
      const deltas = events.filter((e) => e.event === 'content_block_delta');
      expect(deltas.length).toBeGreaterThan(0);

      // Collect content
      let fullContent = '';
      for (const delta of deltas) {
        if (delta.data.delta?.text) {
          fullContent += delta.data.delta.text;
        }
      }

      expect(fullContent).toBeTruthy();
      expect(fullContent).toMatch(/1|2|3/);
    }, 60000);

    it('should include content_block_start and content_block_stop', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 20,
          stream: true,
        }),
      });

      expect(response.status).toBe(200);

      const text = await response.text();
      const lines = text.split('\n');

      const eventTypes = lines
        .filter((line) => line.startsWith('event: '))
        .map((line) => line.slice(7));

      expect(eventTypes).toContain('message_start');
      expect(eventTypes).toContain('content_block_start');
      expect(eventTypes).toContain('content_block_stop');
      expect(eventTypes).toContain('message_delta');
      expect(eventTypes).toContain('message_stop');
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should return Anthropic-style error for missing messages', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 100,
        }),
      });

      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.type).toBe('error');
      expect(body.error.type).toBe('invalid_request_error');
    });

    it('should return 400 for missing max_tokens', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid temperature', async () => {
      const response = await fetch(`${ctx.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 100,
          temperature: 1.5, // Anthropic range is 0-1
        }),
      });

      expect(response.status).toBe(400);
    });
  });
});
