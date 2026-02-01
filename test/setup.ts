/**
 * Test setup and utilities
 */

import { vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type { ClaudeStreamMessage } from '../src/core/types.js';

// Mock environment
process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'ERROR'; // Suppress logs during tests

/**
 * Create a mock HTTP request
 */
export function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = options.method || 'GET';
  req.url = options.url || '/';
  req.headers = options.headers || {};

  // Simulate body data
  if (options.body) {
    setTimeout(() => {
      req.emit('data', Buffer.from(JSON.stringify(options.body)));
      req.emit('end');
    }, 0);
  } else {
    setTimeout(() => {
      req.emit('end');
    }, 0);
  }

  return req;
}

/**
 * Create a mock HTTP response
 */
export function createMockResponse(): ServerResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string;
  _chunks: string[];
  _ended: boolean;
} {
  const res = new EventEmitter() as ServerResponse & {
    _statusCode: number;
    _headers: Record<string, string>;
    _body: string;
    _chunks: string[];
    _ended: boolean;
  };

  res._statusCode = 200;
  res._headers = {};
  res._body = '';
  res._chunks = [];
  res._ended = false;

  res.statusCode = 200;

  res.writeHead = vi.fn((statusCode: number, headers?: Record<string, string>) => {
    res._statusCode = statusCode;
    res.statusCode = statusCode;
    if (headers) {
      // Normalize header keys to lowercase
      for (const [key, value] of Object.entries(headers)) {
        res._headers[key.toLowerCase()] = value;
      }
    }
    return res;
  });

  res.setHeader = vi.fn((name: string, value: string) => {
    res._headers[name.toLowerCase()] = value;
    return res;
  });

  res.getHeader = vi.fn((name: string) => {
    return res._headers[name.toLowerCase()];
  });

  res.write = vi.fn((chunk: string | Buffer) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    res._chunks.push(str);
    res._body += str;
    return true;
  });

  res.end = vi.fn((data?: string | Buffer) => {
    if (data) {
      const str = typeof data === 'string' ? data : data.toString();
      res._body += str;
    }
    res._ended = true;
    res.emit('finish');
    return res;
  });

  return res;
}

/**
 * Wait for response to end
 */
export function waitForResponse(res: ReturnType<typeof createMockResponse>): Promise<void> {
  return new Promise((resolve) => {
    if (res._ended) {
      resolve();
    } else {
      res.on('finish', () => resolve());
    }
  });
}

/**
 * Parse SSE events from response body
 */
export function parseSSEEvents(body: string): Array<{ event?: string; data: unknown }> {
  const events: Array<{ event?: string; data: unknown }> = [];
  const lines = body.split('\n');

  let currentEvent: string | undefined;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7);
    } else if (line.startsWith('data: ')) {
      const dataStr = line.slice(6);
      if (dataStr === '[DONE]') {
        events.push({ event: currentEvent, data: '[DONE]' });
      } else {
        try {
          events.push({ event: currentEvent, data: JSON.parse(dataStr) });
        } catch {
          events.push({ event: currentEvent, data: dataStr });
        }
      }
      currentEvent = undefined;
    }
  }

  return events;
}

/**
 * Mock Claude stream events for testing
 */
export function createMockClaudeEvents(text: string): ClaudeStreamMessage[] {
  return [
    {
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          id: 'msg_test123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
    },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
    },
    {
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: 0,
      },
    },
    {
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    },
    {
      type: 'stream_event',
      event: {
        type: 'message_stop',
      },
    },
    {
      type: 'result',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  ];
}

/**
 * Create mock Claude manager
 */
export function createMockClaudeManager(responseText: string = 'Hello, world!') {
  const events = createMockClaudeEvents(responseText);

  return {
    sendMessage: vi.fn((
      prompt: string,
      onEvent: (msg: ClaudeStreamMessage) => void,
      onError: (err: Error) => void,
      onDone: (code: number) => void
    ) => {
      // Simulate async event stream
      let eventIndex = 0;
      const sendNextEvent = () => {
        if (eventIndex < events.length) {
          onEvent(events[eventIndex]!);
          eventIndex++;
          setTimeout(sendNextEvent, 1);
        } else {
          onDone(0);
        }
      };
      setTimeout(sendNextEvent, 1);
    }),
    getStatus: vi.fn(() => ({
      alive: true,
      requestCount: 1,
      queueLength: 0,
      lastActivity: Date.now(),
      pid: 12345,
    })),
    shutdown: vi.fn(),
    ensureProcess: vi.fn(),
  };
}

/**
 * Create mock for non-streaming response
 */
export function createMockClaudeManagerNonStreaming(responseText: string = 'Hello, world!') {
  return {
    sendMessage: vi.fn((
      prompt: string,
      onEvent: (msg: ClaudeStreamMessage) => void,
      onError: (err: Error) => void,
      onDone: (code: number) => void
    ) => {
      // Send assistant message
      onEvent({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: responseText }],
        },
      });

      // Send result with usage
      onEvent({
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      // Complete
      setTimeout(() => onDone(0), 1);
    }),
    getStatus: vi.fn(() => ({
      alive: true,
      requestCount: 1,
      queueLength: 0,
      lastActivity: Date.now(),
      pid: 12345,
    })),
    shutdown: vi.fn(),
    ensureProcess: vi.fn(),
  };
}
