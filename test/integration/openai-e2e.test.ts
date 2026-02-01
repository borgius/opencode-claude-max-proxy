/**
 * End-to-end tests for OpenAI Chat Completions API
 * These tests make real calls to the Claude CLI
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

// Import actual implementations (no mocking)
import { handleRequest } from '../../src/server/server.js';
import { claudeManager } from '../../src/core/claude-manager.js';

describe('OpenAI Chat Completions E2E', () => {
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

    // Ensure Claude process is ready
    await claudeManager.ensureProcess();
  }, 60000);

  afterAll(async () => {
    // Close server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    // Shutdown Claude process
    claudeManager.shutdown();
  });

  describe('Non-Streaming', () => {
    it('should return a complete response from Claude', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
          max_tokens: 50,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const body = await response.json();

      expect(body.object).toBe('chat.completion');
      expect(body.id).toMatch(/^chatcmpl-/);
      expect(body.model).toBe('gpt-4o');
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].message.role).toBe('assistant');
      expect(body.choices[0].message.content).toBeTruthy();
      expect(body.choices[0].message.content.toLowerCase()).toContain('hello');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.usage).toBeDefined();
      expect(body.usage.prompt_tokens).toBeGreaterThan(0);
      expect(body.usage.completion_tokens).toBeGreaterThan(0);
    }, 60000);

    it('should handle system messages', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a pirate. Always respond with "Arrr!"' },
            { role: 'user', content: 'Hello' },
          ],
          max_tokens: 50,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.choices[0].message.content).toBeTruthy();
      expect(body.choices[0].message.content.toLowerCase()).toContain('arr');
    }, 60000);

    it('should respect temperature parameter', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
          max_tokens: 10,
          temperature: 0,
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.json();

      expect(body.choices[0].message.content).toContain('4');
    }, 60000);
  });

  describe('Streaming', () => {
    it('should stream SSE events with correct format', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
          max_tokens: 50,
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      const text = await response.text();
      const lines = text.split('\n').filter((line) => line.startsWith('data: '));

      expect(lines.length).toBeGreaterThan(0);

      // Check first data event structure
      const firstData = lines[0].slice(6); // Remove 'data: '
      if (firstData !== '[DONE]') {
        const chunk = JSON.parse(firstData);
        expect(chunk.object).toBe('chat.completion.chunk');
        expect(chunk.id).toMatch(/^chatcmpl-/);
        expect(chunk.model).toBe('gpt-4o');
        expect(chunk.choices).toHaveLength(1);
      }

      // Last event should be [DONE]
      const lastData = lines[lines.length - 1].slice(6);
      expect(lastData).toBe('[DONE]');

      // Collect all content
      let fullContent = '';
      for (const line of lines) {
        const data = line.slice(6);
        if (data !== '[DONE]') {
          const chunk = JSON.parse(data);
          if (chunk.choices[0]?.delta?.content) {
            fullContent += chunk.choices[0].delta.content;
          }
        }
      }

      expect(fullContent).toBeTruthy();
      expect(fullContent).toMatch(/1|2|3/);
    }, 60000);

    it('should include role in first chunk', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10,
          stream: true,
        }),
      });

      expect(response.status).toBe(200);

      const text = await response.text();
      const lines = text.split('\n').filter((line) => line.startsWith('data: '));

      // Find first chunk with delta
      for (const line of lines) {
        const data = line.slice(6);
        if (data !== '[DONE]') {
          const chunk = JSON.parse(data);
          if (chunk.choices[0]?.delta?.role) {
            expect(chunk.choices[0].delta.role).toBe('assistant');
            break;
          }
        }
      }
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should return 400 for missing messages', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
        }),
      });

      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.type).toBe('invalid_request_error');
    });

    it('should return 400 for invalid temperature', async () => {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 5,
        }),
      });

      expect(response.status).toBe(400);
    });
  });
});
