/**
 * Response format converters between Claude CLI, OpenAI, and Anthropic formats
 */

import type {
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIChoice,
  OpenAIChunkChoice,
  OpenAIUsage,
  AnthropicMessagesResponse,
  AnthropicStreamEvent,
  AnthropicUsage,
  ClaudeStreamMessage,
} from '../core/types.js';

/**
 * Generate a unique message ID
 */
export function generateId(prefix: string = 'chatcmpl'): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Convert Anthropic usage to OpenAI usage format
 */
export function convertUsage(usage?: AnthropicUsage): OpenAIUsage | undefined {
  if (!usage) return undefined;

  return {
    prompt_tokens: usage.input_tokens || 0,
    completion_tokens: usage.output_tokens || 0,
    total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    prompt_tokens_details: usage.cache_read_input_tokens
      ? { cached_tokens: usage.cache_read_input_tokens }
      : undefined,
  };
}

/**
 * Convert Anthropic stop reason to OpenAI finish reason
 */
export function convertStopReason(
  stopReason: AnthropicMessagesResponse['stop_reason']
): OpenAIChoice['finish_reason'] {
  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

/**
 * Build a complete OpenAI chat completion response
 */
export function buildChatCompletionResponse(
  id: string,
  model: string,
  content: string,
  usage?: AnthropicUsage,
  stopReason: AnthropicMessagesResponse['stop_reason'] = 'end_turn'
): OpenAIChatCompletionResponse {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: convertStopReason(stopReason),
        logprobs: null,
      },
    ],
    usage: convertUsage(usage),
  };
}

/**
 * Build a streaming chunk for OpenAI chat completion
 */
export function buildChatCompletionChunk(
  id: string,
  model: string,
  delta: Partial<{ role: string; content: string }>,
  finishReason: OpenAIChunkChoice['finish_reason'] = null,
  usage?: OpenAIUsage | null
): OpenAIChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: delta as any,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage,
  };
}

/**
 * Format SSE data line
 */
export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Format OpenAI-style SSE data line (data only, no event)
 */
export function formatOpenAISSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Build Anthropic message_start event
 */
export function buildAnthropicMessageStart(
  id: string,
  model: string,
  usage?: AnthropicUsage
): AnthropicStreamEvent {
  return {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: usage || { input_tokens: 0, output_tokens: 0 },
    },
  };
}

/**
 * Build Anthropic content_block_start event
 */
export function buildAnthropicContentBlockStart(index: number = 0): AnthropicStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  };
}

/**
 * Build Anthropic content_block_delta event
 */
export function buildAnthropicContentBlockDelta(
  index: number,
  text: string
): AnthropicStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
}

/**
 * Build Anthropic content_block_stop event
 */
export function buildAnthropicContentBlockStop(index: number = 0): AnthropicStreamEvent {
  return {
    type: 'content_block_stop',
    index,
  };
}

/**
 * Build Anthropic message_delta event
 */
export function buildAnthropicMessageDelta(
  stopReason: string = 'end_turn',
  usage?: Partial<AnthropicUsage>
): AnthropicStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: usage ? { output_tokens: usage.output_tokens || 0 } : undefined,
  };
}

/**
 * Build Anthropic message_stop event
 */
export function buildAnthropicMessageStop(): AnthropicStreamEvent {
  return {
    type: 'message_stop',
  };
}

/**
 * Convert Claude CLI stream message to Anthropic stream event
 */
export function claudeToAnthropicStreamEvent(
  msg: ClaudeStreamMessage
): AnthropicStreamEvent | null {
  if (msg.type !== 'stream_event' || !msg.event) {
    return null;
  }
  return msg.event;
}

/**
 * Streaming state tracker for OpenAI format conversion
 */
export class OpenAIStreamingState {
  private id: string;
  private model: string;
  private sentRole = false;
  private finishReason: OpenAIChunkChoice['finish_reason'] = null;
  private totalTokens = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(id: string, model: string) {
    this.id = id;
    this.model = model;
  }

  /**
   * Build initial chunk with role
   */
  buildRoleChunk(): OpenAIChatCompletionChunk {
    this.sentRole = true;
    return buildChatCompletionChunk(this.id, this.model, { role: 'assistant', content: '' });
  }

  /**
   * Build content delta chunk
   */
  buildContentChunk(text: string): OpenAIChatCompletionChunk {
    return buildChatCompletionChunk(this.id, this.model, { content: text });
  }

  /**
   * Build final chunk with finish reason
   */
  buildFinalChunk(stopReason: string = 'end_turn', includeUsage = false): OpenAIChatCompletionChunk {
    this.finishReason = convertStopReason(stopReason as any);

    const usage = includeUsage
      ? {
          prompt_tokens: this.inputTokens,
          completion_tokens: this.outputTokens,
          total_tokens: this.inputTokens + this.outputTokens,
        }
      : null;

    return buildChatCompletionChunk(this.id, this.model, {}, this.finishReason, usage);
  }

  /**
   * Update usage from Anthropic event
   */
  updateUsage(usage?: Partial<AnthropicUsage>): void {
    if (usage) {
      if (usage.input_tokens) this.inputTokens = usage.input_tokens;
      if (usage.output_tokens) this.outputTokens = usage.output_tokens;
      this.totalTokens = this.inputTokens + this.outputTokens;
    }
  }

  /**
   * Check if role chunk has been sent
   */
  hasSentRole(): boolean {
    return this.sentRole;
  }

  /**
   * Get current usage stats
   */
  getUsage(): OpenAIUsage {
    return {
      prompt_tokens: this.inputTokens,
      completion_tokens: this.outputTokens,
      total_tokens: this.totalTokens,
    };
  }
}

/**
 * Anthropic streaming state tracker
 */
export class AnthropicStreamingState {
  private id: string;
  private model: string;
  private sentMessageStart = false;
  private sentBlockStart = false;
  private blockIndex = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(id: string, model: string) {
    this.id = id;
    this.model = model;
  }

  /**
   * Build message_start event if not sent
   */
  buildMessageStart(usage?: AnthropicUsage): { event: AnthropicStreamEvent; sent: boolean } {
    if (this.sentMessageStart) {
      return { event: buildAnthropicMessageStart(this.id, this.model, usage), sent: false };
    }
    this.sentMessageStart = true;
    if (usage) {
      this.inputTokens = usage.input_tokens || 0;
    }
    return { event: buildAnthropicMessageStart(this.id, this.model, usage), sent: true };
  }

  /**
   * Build content_block_start event if not sent
   */
  buildContentBlockStart(): { event: AnthropicStreamEvent; sent: boolean } {
    if (this.sentBlockStart) {
      return { event: buildAnthropicContentBlockStart(this.blockIndex), sent: false };
    }
    this.sentBlockStart = true;
    return { event: buildAnthropicContentBlockStart(this.blockIndex), sent: true };
  }

  /**
   * Build content_block_delta event
   */
  buildContentBlockDelta(text: string): AnthropicStreamEvent {
    return buildAnthropicContentBlockDelta(this.blockIndex, text);
  }

  /**
   * Build content_block_stop event
   */
  buildContentBlockStop(): AnthropicStreamEvent {
    const event = buildAnthropicContentBlockStop(this.blockIndex);
    this.blockIndex++;
    this.sentBlockStart = false;
    return event;
  }

  /**
   * Build message_delta event
   */
  buildMessageDelta(stopReason: string = 'end_turn', outputTokens?: number): AnthropicStreamEvent {
    if (outputTokens) this.outputTokens = outputTokens;
    return buildAnthropicMessageDelta(stopReason, { output_tokens: this.outputTokens });
  }

  /**
   * Build message_stop event
   */
  buildMessageStop(): AnthropicStreamEvent {
    return buildAnthropicMessageStop();
  }

  /**
   * Check if message_start has been sent
   */
  hasSentMessageStart(): boolean {
    return this.sentMessageStart;
  }

  /**
   * Check if content_block_start has been sent
   */
  hasSentBlockStart(): boolean {
    return this.sentBlockStart;
  }
}

export const responseConverters = {
  generateId,
  convertUsage,
  convertStopReason,
  buildChatCompletionResponse,
  buildChatCompletionChunk,
  formatSSE,
  formatOpenAISSE,
  buildAnthropicMessageStart,
  buildAnthropicContentBlockStart,
  buildAnthropicContentBlockDelta,
  buildAnthropicContentBlockStop,
  buildAnthropicMessageDelta,
  buildAnthropicMessageStop,
  claudeToAnthropicStreamEvent,
  OpenAIStreamingState,
  AnthropicStreamingState,
};

export default responseConverters;
