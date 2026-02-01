/**
 * Message format converters between OpenAI, Anthropic, and Claude CLI
 */

import type {
  OpenAIMessage,
  OpenAIChatCompletionRequest,
  OpenAIContentPart,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicContentBlock,
} from '../core/types.js';

/**
 * Convert OpenAI messages to a single prompt string for Claude CLI
 */
export function openaiMessagesToPrompt(messages: OpenAIMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    let text = '';

    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c): c is OpenAIContentPart & { type: 'text' } => c.type === 'text')
        .map(c => c.text || '')
        .join('\n');
    } else if (msg.content === null && msg.tool_calls) {
      // Tool call response - format the tool calls
      text = msg.tool_calls
        .map(tc => `[Tool: ${tc.function.name}(${tc.function.arguments})]`)
        .join('\n');
    }

    if (text) {
      // Add role prefix for context
      const rolePrefix = getRolePrefix(msg.role);
      parts.push(rolePrefix ? `${rolePrefix}: ${text}` : text);
    }
  }

  return parts.join('\n\n');
}

/**
 * Get role prefix for message formatting
 */
function getRolePrefix(role: string): string {
  switch (role) {
    case 'system':
    case 'developer':
      return 'System';
    case 'user':
      return '';  // No prefix for user messages (they're the main prompt)
    case 'assistant':
      return 'Assistant';
    case 'tool':
    case 'function':
      return 'Tool Result';
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/**
 * Convert Anthropic messages to prompt string
 */
export function anthropicMessagesToPrompt(
  messages: AnthropicMessage[],
  system?: string | { type: 'text'; text: string }[]
): string {
  const parts: string[] = [];

  // Add system message if present
  if (system) {
    if (typeof system === 'string') {
      parts.push(`System: ${system}`);
    } else if (Array.isArray(system)) {
      const systemText = system.map(s => s.text).join('\n');
      parts.push(`System: ${systemText}`);
    }
  }

  for (const msg of messages) {
    let text = '';

    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c): c is AnthropicContentBlock & { type: 'text' } => c.type === 'text')
        .map(c => c.text || '')
        .join('\n');
    }

    if (text) {
      const prefix = msg.role === 'user' ? '' : 'Assistant';
      parts.push(prefix ? `${prefix}: ${text}` : text);
    }
  }

  return parts.join('\n\n');
}

/**
 * Extract system message from OpenAI messages
 */
export function extractSystemMessage(messages: OpenAIMessage[]): {
  system: string | null;
  remainingMessages: OpenAIMessage[];
} {
  const systemMessages = messages.filter(
    m => m.role === 'system' || m.role === 'developer'
  );
  const remainingMessages = messages.filter(
    m => m.role !== 'system' && m.role !== 'developer'
  );

  if (systemMessages.length === 0) {
    return { system: null, remainingMessages };
  }

  const systemText = systemMessages
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((c): c is OpenAIContentPart & { type: 'text' } => c.type === 'text')
          .map(c => c.text || '')
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  return { system: systemText || null, remainingMessages };
}

/**
 * Check if request contains vision/image content
 */
export function hasVisionContent(messages: OpenAIMessage[]): boolean {
  return messages.some(msg => {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some(part => part.type === 'image_url');
  });
}

/**
 * Check if request contains audio content
 */
export function hasAudioContent(messages: OpenAIMessage[]): boolean {
  return messages.some(msg => {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some(part => part.type === 'input_audio');
  });
}

/**
 * Check if request has tool calls
 */
export function hasToolCalls(messages: OpenAIMessage[]): boolean {
  return messages.some(msg => msg.tool_calls && msg.tool_calls.length > 0);
}

/**
 * Convert OpenAI chat completion request to Anthropic messages format
 * This is useful for logging and debugging
 */
export function openaiToAnthropicRequest(
  request: OpenAIChatCompletionRequest
): AnthropicMessagesRequest {
  const { system, remainingMessages } = extractSystemMessage(request.messages);

  const anthropicMessages: AnthropicMessage[] = remainingMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: typeof msg.content === 'string'
      ? msg.content
      : convertOpenAIContentToAnthropic(msg.content),
  }));

  return {
    model: request.model,
    messages: anthropicMessages,
    max_tokens: request.max_tokens || request.max_completion_tokens || 4096,
    system: system || undefined,
    temperature: request.temperature,
    top_p: request.top_p,
    stop_sequences: Array.isArray(request.stop)
      ? request.stop
      : request.stop
        ? [request.stop]
        : undefined,
    stream: request.stream,
  };
}

/**
 * Convert OpenAI content parts to Anthropic content blocks
 */
function convertOpenAIContentToAnthropic(
  content: OpenAIContentPart[] | null
): AnthropicContentBlock[] {
  if (!content) return [];

  return content
    .filter(part => part.type === 'text' || part.type === 'image_url')
    .map(part => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text || '' };
      }
      if (part.type === 'image_url' && part.image_url) {
        // Extract base64 data if it's a data URL
        const url = part.image_url.url;
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: match[1],
                data: match[2],
              },
            };
          }
        }
        // For HTTP URLs, we'd need to fetch - not supported in Claude CLI directly
        return { type: 'text' as const, text: `[Image: ${url}]` };
      }
      return { type: 'text' as const, text: '' };
    });
}

export const messageConverters = {
  openaiMessagesToPrompt,
  anthropicMessagesToPrompt,
  extractSystemMessage,
  hasVisionContent,
  hasAudioContent,
  hasToolCalls,
  openaiToAnthropicRequest,
};

export default messageConverters;
