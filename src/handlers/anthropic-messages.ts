/**
 * Anthropic Messages API Handler
 * Native Anthropic API format support
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  ClaudeStreamMessage,
  AnthropicUsage,
  AnthropicContentBlock,
} from '../core/types.js';
import { logger } from '../core/logger.js';
import { claudeManager } from '../core/claude-manager.js';
import { anthropicMessagesToPrompt } from '../converters/messages.js';
import {
  generateId,
  AnthropicStreamingState,
  formatSSE,
} from '../converters/responses.js';

/**
 * Validate Anthropic messages request
 */
export function validateRequest(body: unknown): {
  valid: boolean;
  error?: string;
  request?: AnthropicMessagesRequest;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const req = body as Record<string, unknown>;

  // Required: model
  if (!req.model || typeof req.model !== 'string') {
    return { valid: false, error: 'model string is required' };
  }

  // Required: messages
  if (!req.messages || !Array.isArray(req.messages)) {
    return { valid: false, error: 'messages array is required' };
  }

  if (req.messages.length === 0) {
    return { valid: false, error: 'messages array cannot be empty' };
  }

  // Required: max_tokens
  if (req.max_tokens === undefined || typeof req.max_tokens !== 'number') {
    return { valid: false, error: 'max_tokens number is required' };
  }

  // Validate optional parameters
  if (req.temperature !== undefined) {
    const temp = req.temperature as number;
    if (typeof temp !== 'number' || temp < 0 || temp > 1) {
      return { valid: false, error: 'temperature must be a number between 0 and 1' };
    }
  }

  if (req.top_p !== undefined) {
    const topP = req.top_p as number;
    if (typeof topP !== 'number' || topP < 0 || topP > 1) {
      return { valid: false, error: 'top_p must be a number between 0 and 1' };
    }
  }

  if (req.top_k !== undefined) {
    const topK = req.top_k as number;
    if (typeof topK !== 'number' || topK < 0) {
      return { valid: false, error: 'top_k must be a non-negative number' };
    }
  }

  return { valid: true, request: req as unknown as AnthropicMessagesRequest };
}

/**
 * Log request parameters for debugging
 */
function logRequestParams(reqId: string, request: AnthropicMessagesRequest): void {
  const params: Record<string, unknown> = {
    model: request.model,
    messagesCount: request.messages.length,
    max_tokens: request.max_tokens,
    stream: request.stream,
  };

  if (request.system) {
    params.hasSystem = true;
    params.systemType = typeof request.system === 'string' ? 'string' : 'array';
  }
  if (request.temperature !== undefined) params.temperature = request.temperature;
  if (request.top_p !== undefined) params.top_p = request.top_p;
  if (request.top_k !== undefined) params.top_k = request.top_k;
  if (request.stop_sequences) params.stopSequencesCount = request.stop_sequences.length;
  if (request.tools) params.toolsCount = request.tools.length;
  if (request.metadata) params.hasMetadata = true;

  logger.info('Anthropic messages request', { reqId, ...params });
}

/**
 * Handle streaming response
 */
function handleStreamingResponse(
  res: ServerResponse,
  request: AnthropicMessagesRequest,
  reqId: string
): void {
  const msgId = generateId('msg');
  const model = request.model;

  // Set streaming headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Convert to prompt
  const systemPrompt = typeof request.system === 'string'
    ? request.system
    : Array.isArray(request.system)
      ? request.system.map(s => s.text).join('\n')
      : undefined;

  const prompt = anthropicMessagesToPrompt(request.messages, systemPrompt);
  const state = new AnthropicStreamingState(msgId, model);

  claudeManager.sendMessage(
    prompt,
    // onEvent
    (msg: ClaudeStreamMessage) => {
      if (msg.type === 'stream_event' && msg.event) {
        const evt = msg.event;

        // Forward message_start
        if (evt.type === 'message_start') {
          const { event, sent } = state.buildMessageStart(evt.message?.usage);
          if (sent || !state.hasSentMessageStart()) {
            // Override with our ID and model
            const customEvent = {
              ...event,
              message: {
                ...event.message,
                id: msgId,
                model: model,
              },
            };
            res.write(formatSSE('message_start', customEvent));
          }
        }

        // Forward content_block_start
        if (evt.type === 'content_block_start') {
          const { event, sent } = state.buildContentBlockStart();
          if (sent) {
            res.write(formatSSE('content_block_start', event));
          }
        }

        // Forward content_block_delta
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          const event = state.buildContentBlockDelta(evt.delta.text);
          res.write(formatSSE('content_block_delta', event));
        }

        // Forward content_block_stop
        if (evt.type === 'content_block_stop') {
          const event = state.buildContentBlockStop();
          res.write(formatSSE('content_block_stop', event));
        }

        // Forward message_delta
        if (evt.type === 'message_delta') {
          const stopReason = evt.delta?.stop_reason || 'end_turn';
          const outputTokens = evt.usage?.output_tokens;
          const event = state.buildMessageDelta(stopReason, outputTokens);
          res.write(formatSSE('message_delta', event));
        }

        // Forward message_stop
        if (evt.type === 'message_stop') {
          const event = state.buildMessageStop();
          res.write(formatSSE('message_stop', event));
        }

        // Forward ping events
        if (evt.type === 'ping') {
          res.write(formatSSE('ping', { type: 'ping' }));
        }
      }
    },
    // onError
    (err: Error) => {
      logger.error('Streaming error', { reqId, error: err.message });
      res.write(formatSSE('error', {
        type: 'error',
        error: { type: 'api_error', message: err.message },
      }));
      res.end();
    },
    // onDone
    (code: number) => {
      logger.info('Streaming complete', { reqId });
      res.end();
    }
  );
}

/**
 * Handle non-streaming response
 */
function handleNonStreamingResponse(
  res: ServerResponse,
  request: AnthropicMessagesRequest,
  reqId: string
): void {
  const msgId = generateId('msg');
  const model = request.model;

  // Convert to prompt
  const systemPrompt = typeof request.system === 'string'
    ? request.system
    : Array.isArray(request.system)
      ? request.system.map(s => s.text).join('\n')
      : undefined;

  const prompt = anthropicMessagesToPrompt(request.messages, systemPrompt);

  let accumulatedText = '';
  let usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };
  let stopReason: AnthropicMessagesResponse['stop_reason'] = 'end_turn';

  claudeManager.sendMessage(
    prompt,
    // onEvent
    (msg: ClaudeStreamMessage) => {
      // Accumulate text from assistant messages
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            accumulatedText += block.text;
          }
        }
      }

      // Get usage from result
      if (msg.type === 'result' && msg.usage) {
        usage = msg.usage;
      }

      // Get stop reason and usage from stream events
      if (msg.type === 'stream_event' && msg.event?.type === 'message_delta') {
        if (msg.event.delta?.stop_reason) {
          stopReason = msg.event.delta.stop_reason as AnthropicMessagesResponse['stop_reason'];
        }
        if (msg.event.usage) {
          usage = { ...usage, ...msg.event.usage };
        }
      }

      // Get usage from message_start
      if (msg.type === 'stream_event' && msg.event?.type === 'message_start') {
        if (msg.event.message?.usage) {
          usage = { ...usage, ...msg.event.message.usage };
        }
      }
    },
    // onError
    (err: Error) => {
      logger.error('Non-streaming error', { reqId, error: err.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: err.message },
      }));
    },
    // onDone
    (code: number) => {
      logger.info('Non-streaming complete', {
        reqId,
        textLength: accumulatedText.length,
        usage,
      });

      const content: AnthropicContentBlock[] = accumulatedText
        ? [{ type: 'text', text: accumulatedText }]
        : [];

      const response: AnthropicMessagesResponse = {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content,
        model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    }
  );
}

/**
 * Main handler for Anthropic messages
 */
export async function handleAnthropicMessages(
  req: IncomingMessage,
  res: ServerResponse,
  body: AnthropicMessagesRequest,
  reqId: string
): Promise<void> {
  // Validate request
  const validation = validateRequest(body);
  if (!validation.valid) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: validation.error },
    }));
    return;
  }

  const request = validation.request!;
  logRequestParams(reqId, request);

  // Handle streaming vs non-streaming
  if (request.stream) {
    handleStreamingResponse(res, request, reqId);
  } else {
    handleNonStreamingResponse(res, request, reqId);
  }
}

/**
 * Extract supported parameters info (for documentation/debugging)
 */
export const supportedParameters = {
  required: ['model', 'messages', 'max_tokens'],
  supported: [
    'stream',
    'system',
    'stop_sequences',
    'temperature',
    'top_p',
    'top_k',
    'tools',
    'tool_choice',
    'metadata',
  ],
  passthrough: [
    // These are accepted but may not affect Claude CLI behavior
    'top_k',
  ],
};

export default handleAnthropicMessages;
