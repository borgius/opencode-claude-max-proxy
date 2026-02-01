/**
 * OpenAI Chat Completions API Handler
 * Supports all OpenAI chat completion parameters
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  ClaudeStreamMessage,
  AnthropicUsage,
} from '../core/types.js';
import { logger } from '../core/logger.js';
import { openaiMessagesToPrompt } from '../converters/messages.js';

// Lazy import to avoid loading ClaudeProcessManager on module init
let _claudeManager: typeof import('../core/claude-manager.js').claudeManager | null = null;
async function getClaudeManager() {
  if (!_claudeManager) {
    const mod = await import('../core/claude-manager.js');
    _claudeManager = mod.claudeManager;
  }
  return _claudeManager;
}
import {
  generateId,
  buildChatCompletionResponse,
  OpenAIStreamingState,
  formatOpenAISSE,
} from '../converters/responses.js';

/**
 * Validate OpenAI chat completion request
 */
export function validateRequest(body: unknown): {
  valid: boolean;
  error?: string;
  request?: OpenAIChatCompletionRequest;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const req = body as Record<string, unknown>;

  // Required: messages
  if (!req.messages || !Array.isArray(req.messages)) {
    return { valid: false, error: 'messages array is required' };
  }

  if (req.messages.length === 0) {
    return { valid: false, error: 'messages array cannot be empty' };
  }

  // Required: model
  if (!req.model || typeof req.model !== 'string') {
    return { valid: false, error: 'model string is required' };
  }

  // Validate optional parameters
  if (req.temperature !== undefined) {
    const temp = req.temperature as number;
    if (typeof temp !== 'number' || temp < 0 || temp > 2) {
      return { valid: false, error: 'temperature must be a number between 0 and 2' };
    }
  }

  if (req.top_p !== undefined) {
    const topP = req.top_p as number;
    if (typeof topP !== 'number' || topP < 0 || topP > 1) {
      return { valid: false, error: 'top_p must be a number between 0 and 1' };
    }
  }

  if (req.n !== undefined) {
    const n = req.n as number;
    if (typeof n !== 'number' || n < 1 || !Number.isInteger(n)) {
      return { valid: false, error: 'n must be a positive integer' };
    }
  }

  if (req.max_tokens !== undefined && typeof req.max_tokens !== 'number') {
    return { valid: false, error: 'max_tokens must be a number' };
  }

  if (req.max_completion_tokens !== undefined && typeof req.max_completion_tokens !== 'number') {
    return { valid: false, error: 'max_completion_tokens must be a number' };
  }

  if (req.frequency_penalty !== undefined) {
    const fp = req.frequency_penalty as number;
    if (typeof fp !== 'number' || fp < -2 || fp > 2) {
      return { valid: false, error: 'frequency_penalty must be a number between -2 and 2' };
    }
  }

  if (req.presence_penalty !== undefined) {
    const pp = req.presence_penalty as number;
    if (typeof pp !== 'number' || pp < -2 || pp > 2) {
      return { valid: false, error: 'presence_penalty must be a number between -2 and 2' };
    }
  }

  return { valid: true, request: req as unknown as OpenAIChatCompletionRequest };
}

/**
 * Log request parameters for debugging
 */
function logRequestParams(reqId: string, request: OpenAIChatCompletionRequest): void {
  const params: Record<string, unknown> = {
    model: request.model,
    messagesCount: request.messages.length,
    stream: request.stream,
  };

  if (request.max_tokens) params.max_tokens = request.max_tokens;
  if (request.max_completion_tokens) params.max_completion_tokens = request.max_completion_tokens;
  if (request.temperature !== undefined) params.temperature = request.temperature;
  if (request.top_p !== undefined) params.top_p = request.top_p;
  if (request.n !== undefined) params.n = request.n;
  if (request.stop) params.stop = request.stop;
  if (request.tools) params.toolsCount = request.tools.length;
  if (request.response_format) params.response_format = request.response_format.type;
  if (request.reasoning_effort) params.reasoning_effort = request.reasoning_effort;
  if (request.seed !== undefined) params.seed = request.seed;
  if (request.logprobs) params.logprobs = request.logprobs;
  if (request.user) params.user = request.user;
  if (request.service_tier) params.service_tier = request.service_tier;
  if (request.store !== undefined) params.store = request.store;

  logger.info('OpenAI chat completion request', { reqId, ...params });
}

/**
 * Handle streaming response
 */
async function handleStreamingResponse(
  res: ServerResponse,
  request: OpenAIChatCompletionRequest,
  reqId: string
): Promise<void> {
  const msgId = generateId('chatcmpl');
  const model = request.model;
  const includeUsage = request.stream_options?.include_usage ?? false;

  // Set streaming headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const prompt = openaiMessagesToPrompt(request.messages);
  const state = new OpenAIStreamingState(msgId, model);
  let accumulatedText = '';

  const claudeManager = await getClaudeManager();
  claudeManager.sendMessage(
    prompt,
    // onEvent
    (msg: ClaudeStreamMessage) => {
      if (msg.type === 'stream_event' && msg.event) {
        const evt = msg.event;

        // Handle message_start - send role chunk
        if (evt.type === 'message_start' && !state.hasSentRole()) {
          const chunk = state.buildRoleChunk();
          res.write(formatOpenAISSE(chunk));

          // Update usage from message_start
          if (evt.message?.usage) {
            state.updateUsage(evt.message.usage);
          }
        }

        // Handle content_block_delta - send content chunks
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          const chunk = state.buildContentChunk(evt.delta.text);
          res.write(formatOpenAISSE(chunk));
          accumulatedText += evt.delta.text;
        }

        // Handle message_delta - update usage and get stop reason
        if (evt.type === 'message_delta') {
          if (evt.usage) {
            state.updateUsage(evt.usage);
          }
        }

        // Handle message_stop - send final chunk
        if (evt.type === 'message_stop') {
          const chunk = state.buildFinalChunk('end_turn', includeUsage);
          res.write(formatOpenAISSE(chunk));
          res.write('data: [DONE]\n\n');
        }
      }
    },
    // onError
    (err: Error) => {
      logger.error('Streaming error', { reqId, error: err.message });
      res.write(formatOpenAISSE({ error: { message: err.message, type: 'api_error' } }));
      res.end();
    },
    // onDone
    (code: number) => {
      logger.info('Streaming complete', {
        reqId,
        usage: state.getUsage(),
        textLength: accumulatedText.length,
      });
      res.end();
    }
  );
}

/**
 * Handle non-streaming response
 */
async function handleNonStreamingResponse(
  res: ServerResponse,
  request: OpenAIChatCompletionRequest,
  reqId: string
): Promise<void> {
  const msgId = generateId('chatcmpl');
  const model = request.model;

  const prompt = openaiMessagesToPrompt(request.messages);
  let accumulatedText = '';
  let usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };
  let stopReason: string = 'end_turn';

  const claudeManager = await getClaudeManager();
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

      // Get stop reason from stream events
      if (msg.type === 'stream_event' && msg.event?.type === 'message_delta') {
        if (msg.event.delta?.stop_reason) {
          stopReason = msg.event.delta.stop_reason;
        }
        if (msg.event.usage) {
          usage = { ...usage, ...msg.event.usage };
        }
      }
    },
    // onError
    (err: Error) => {
      logger.error('Non-streaming error', { reqId, error: err.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: err.message, type: 'api_error' },
      }));
    },
    // onDone
    (code: number) => {
      logger.info('Non-streaming complete', {
        reqId,
        textLength: accumulatedText.length,
        usage,
      });

      const response = buildChatCompletionResponse(
        msgId,
        model,
        accumulatedText,
        usage,
        stopReason as any
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    }
  );
}

/**
 * Main handler for OpenAI chat completions
 */
export async function handleOpenAIChatCompletion(
  req: IncomingMessage,
  res: ServerResponse,
  body: OpenAIChatCompletionRequest,
  reqId: string
): Promise<void> {
  // Validate request
  const validation = validateRequest(body);
  if (!validation.valid) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: validation.error, type: 'invalid_request_error' },
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
  required: ['model', 'messages'],
  supported: [
    'stream',
    'stream_options',
    'max_tokens',
    'max_completion_tokens',
    'temperature',
    'top_p',
    'n',
    'stop',
    'frequency_penalty',
    'presence_penalty',
    'logprobs',
    'top_logprobs',
    'logit_bias',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'response_format',
    'seed',
    'user',
    'service_tier',
    'store',
    'metadata',
    'reasoning_effort',
    'modalities',
    'audio',
    'prediction',
    'web_search_options',
  ],
  passthrough: [
    // These are accepted but may not affect Claude behavior
    'frequency_penalty',
    'presence_penalty',
    'logit_bias',
    'logprobs',
    'top_logprobs',
    'seed',
    'service_tier',
    'modalities',
    'audio',
    'prediction',
    'web_search_options',
  ],
  notSupported: [
    // Legacy function calling (use tools instead)
    'functions',
    'function_call',
  ],
};

export default handleOpenAIChatCompletion;
