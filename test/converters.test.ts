/**
 * Tests for message and response converters
 */

import { describe, it, expect } from 'vitest';
import {
  openaiMessagesToPrompt,
  anthropicMessagesToPrompt,
  extractSystemMessage,
  hasVisionContent,
  hasAudioContent,
  hasToolCalls,
} from '../src/converters/messages.js';
import {
  generateId,
  convertUsage,
  convertStopReason,
  buildChatCompletionResponse,
  buildChatCompletionChunk,
  formatSSE,
  formatOpenAISSE,
  OpenAIStreamingState,
  AnthropicStreamingState,
} from '../src/converters/responses.js';

describe('Message Converters', () => {
  describe('openaiMessagesToPrompt', () => {
    it('should convert simple string messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
        { role: 'user' as const, content: 'How are you?' },
      ];

      const prompt = openaiMessagesToPrompt(messages);

      expect(prompt).toContain('Hello');
      expect(prompt).toContain('Assistant: Hi there!');
      expect(prompt).toContain('How are you?');
    });

    it('should handle system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' },
      ];

      const prompt = openaiMessagesToPrompt(messages);

      expect(prompt).toContain('System: You are helpful');
      expect(prompt).toContain('Hello');
    });

    it('should handle array content with text parts', () => {
      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Part 1' },
            { type: 'text' as const, text: 'Part 2' },
          ],
        },
      ];

      const prompt = openaiMessagesToPrompt(messages);

      expect(prompt).toContain('Part 1');
      expect(prompt).toContain('Part 2');
    });

    it('should skip image content', () => {
      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Look at this' },
            { type: 'image_url' as const, image_url: { url: 'http://example.com/img.png' } },
          ],
        },
      ];

      const prompt = openaiMessagesToPrompt(messages);

      expect(prompt).toContain('Look at this');
      expect(prompt).not.toContain('image_url');
    });

    it('should handle tool calls in assistant messages', () => {
      const messages = [
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function' as const,
              function: { name: 'get_weather', arguments: '{"city":"SF"}' },
            },
          ],
        },
      ];

      const prompt = openaiMessagesToPrompt(messages);

      expect(prompt).toContain('get_weather');
      expect(prompt).toContain('SF');
    });
  });

  describe('anthropicMessagesToPrompt', () => {
    it('should convert Anthropic messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi!' },
      ];

      const prompt = anthropicMessagesToPrompt(messages);

      expect(prompt).toContain('Hello');
      expect(prompt).toContain('Assistant: Hi!');
    });

    it('should include system message', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const system = 'You are a helpful assistant';

      const prompt = anthropicMessagesToPrompt(messages, system);

      expect(prompt).toContain('System: You are a helpful assistant');
    });

    it('should handle system message array', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const system = [
        { type: 'text' as const, text: 'Part 1' },
        { type: 'text' as const, text: 'Part 2' },
      ];

      const prompt = anthropicMessagesToPrompt(messages, system);

      expect(prompt).toContain('Part 1');
      expect(prompt).toContain('Part 2');
    });
  });

  describe('extractSystemMessage', () => {
    it('should extract system message from messages', () => {
      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' },
      ];

      const { system, remainingMessages } = extractSystemMessage(messages);

      expect(system).toBe('You are helpful');
      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].role).toBe('user');
    });

    it('should handle developer role as system', () => {
      const messages = [
        { role: 'developer' as const, content: 'Custom instructions' },
        { role: 'user' as const, content: 'Hello' },
      ];

      const { system, remainingMessages } = extractSystemMessage(messages);

      expect(system).toBe('Custom instructions');
      expect(remainingMessages).toHaveLength(1);
    });

    it('should combine multiple system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'Rule 1' },
        { role: 'system' as const, content: 'Rule 2' },
        { role: 'user' as const, content: 'Hello' },
      ];

      const { system, remainingMessages } = extractSystemMessage(messages);

      expect(system).toContain('Rule 1');
      expect(system).toContain('Rule 2');
      expect(remainingMessages).toHaveLength(1);
    });

    it('should return null if no system message', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      const { system, remainingMessages } = extractSystemMessage(messages);

      expect(system).toBeNull();
      expect(remainingMessages).toHaveLength(1);
    });
  });

  describe('hasVisionContent', () => {
    it('should detect image_url content', () => {
      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Look' },
            { type: 'image_url' as const, image_url: { url: 'http://example.com/img.png' } },
          ],
        },
      ];

      expect(hasVisionContent(messages)).toBe(true);
    });

    it('should return false for text-only', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      expect(hasVisionContent(messages)).toBe(false);
    });
  });

  describe('hasAudioContent', () => {
    it('should detect input_audio content', () => {
      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'input_audio' as const, input_audio: { data: 'base64...', format: 'wav' as const } },
          ],
        },
      ];

      expect(hasAudioContent(messages)).toBe(true);
    });
  });

  describe('hasToolCalls', () => {
    it('should detect tool calls', () => {
      const messages = [
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'test', arguments: '{}' } }],
        },
      ];

      expect(hasToolCalls(messages)).toBe(true);
    });

    it('should return false without tool calls', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      expect(hasToolCalls(messages)).toBe(false);
    });
  });
});

describe('Response Converters', () => {
  describe('generateId', () => {
    it('should generate ID with prefix', () => {
      const id = generateId('test');
      expect(id).toMatch(/^test-[a-z0-9]+$/);
    });

    it('should use default prefix', () => {
      const id = generateId();
      expect(id).toMatch(/^chatcmpl-[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set([generateId(), generateId(), generateId()]);
      expect(ids.size).toBe(3);
    });
  });

  describe('convertUsage', () => {
    it('should convert Anthropic usage to OpenAI format', () => {
      const anthropicUsage = { input_tokens: 100, output_tokens: 50 };

      const openaiUsage = convertUsage(anthropicUsage);

      expect(openaiUsage?.prompt_tokens).toBe(100);
      expect(openaiUsage?.completion_tokens).toBe(50);
      expect(openaiUsage?.total_tokens).toBe(150);
    });

    it('should handle cache tokens', () => {
      const anthropicUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
      };

      const openaiUsage = convertUsage(anthropicUsage);

      expect(openaiUsage?.prompt_tokens_details?.cached_tokens).toBe(20);
    });

    it('should return undefined for undefined input', () => {
      expect(convertUsage(undefined)).toBeUndefined();
    });
  });

  describe('convertStopReason', () => {
    it('should convert end_turn to stop', () => {
      expect(convertStopReason('end_turn')).toBe('stop');
    });

    it('should convert max_tokens to length', () => {
      expect(convertStopReason('max_tokens')).toBe('length');
    });

    it('should convert tool_use to tool_calls', () => {
      expect(convertStopReason('tool_use')).toBe('tool_calls');
    });

    it('should default to stop for unknown reasons', () => {
      expect(convertStopReason(null)).toBe('stop');
    });
  });

  describe('buildChatCompletionResponse', () => {
    it('should build complete response', () => {
      const response = buildChatCompletionResponse(
        'chatcmpl-test',
        'gpt-4o',
        'Hello!',
        { input_tokens: 10, output_tokens: 5 }
      );

      expect(response.id).toBe('chatcmpl-test');
      expect(response.object).toBe('chat.completion');
      expect(response.model).toBe('gpt-4o');
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].message.role).toBe('assistant');
      expect(response.choices[0].message.content).toBe('Hello!');
      expect(response.choices[0].finish_reason).toBe('stop');
      expect(response.usage?.total_tokens).toBe(15);
    });
  });

  describe('buildChatCompletionChunk', () => {
    it('should build streaming chunk', () => {
      const chunk = buildChatCompletionChunk(
        'chatcmpl-test',
        'gpt-4o',
        { content: 'Hello' }
      );

      expect(chunk.id).toBe('chatcmpl-test');
      expect(chunk.object).toBe('chat.completion.chunk');
      expect(chunk.model).toBe('gpt-4o');
      expect(chunk.choices[0].delta.content).toBe('Hello');
    });

    it('should include finish_reason when provided', () => {
      const chunk = buildChatCompletionChunk(
        'chatcmpl-test',
        'gpt-4o',
        {},
        'stop'
      );

      expect(chunk.choices[0].finish_reason).toBe('stop');
    });
  });

  describe('formatSSE', () => {
    it('should format SSE with event and data', () => {
      const sse = formatSSE('message_start', { type: 'message_start' });

      expect(sse).toBe('event: message_start\ndata: {"type":"message_start"}\n\n');
    });
  });

  describe('formatOpenAISSE', () => {
    it('should format OpenAI-style SSE (data only)', () => {
      const sse = formatOpenAISSE({ id: 'test', choices: [] });

      expect(sse).toMatch(/^data: \{.+\}\n\n$/);
      expect(sse).not.toContain('event:');
    });
  });

  describe('OpenAIStreamingState', () => {
    it('should track streaming state', () => {
      const state = new OpenAIStreamingState('chatcmpl-test', 'gpt-4o');

      expect(state.hasSentRole()).toBe(false);

      const roleChunk = state.buildRoleChunk();
      expect(roleChunk.choices[0].delta.role).toBe('assistant');
      expect(state.hasSentRole()).toBe(true);
    });

    it('should build content chunks', () => {
      const state = new OpenAIStreamingState('chatcmpl-test', 'gpt-4o');

      const chunk = state.buildContentChunk('Hello');
      expect(chunk.choices[0].delta.content).toBe('Hello');
    });

    it('should track usage', () => {
      const state = new OpenAIStreamingState('chatcmpl-test', 'gpt-4o');

      state.updateUsage({ input_tokens: 100, output_tokens: 50 });

      const usage = state.getUsage();
      expect(usage.prompt_tokens).toBe(100);
      expect(usage.completion_tokens).toBe(50);
      expect(usage.total_tokens).toBe(150);
    });

    it('should build final chunk with usage', () => {
      const state = new OpenAIStreamingState('chatcmpl-test', 'gpt-4o');
      state.updateUsage({ input_tokens: 10, output_tokens: 5 });

      const chunk = state.buildFinalChunk('end_turn', true);

      expect(chunk.choices[0].finish_reason).toBe('stop');
      expect(chunk.usage?.total_tokens).toBe(15);
    });
  });

  describe('AnthropicStreamingState', () => {
    it('should track message_start state', () => {
      const state = new AnthropicStreamingState('msg-test', 'claude-3');

      expect(state.hasSentMessageStart()).toBe(false);

      const { event, sent } = state.buildMessageStart();
      expect(sent).toBe(true);
      expect(event.type).toBe('message_start');
      expect(state.hasSentMessageStart()).toBe(true);

      // Second call should not send
      const { sent: sent2 } = state.buildMessageStart();
      expect(sent2).toBe(false);
    });

    it('should track content_block state', () => {
      const state = new AnthropicStreamingState('msg-test', 'claude-3');

      const { sent } = state.buildContentBlockStart();
      expect(sent).toBe(true);
      expect(state.hasSentBlockStart()).toBe(true);
    });

    it('should build content delta', () => {
      const state = new AnthropicStreamingState('msg-test', 'claude-3');

      const delta = state.buildContentBlockDelta('Hello');
      expect(delta.type).toBe('content_block_delta');
      expect(delta.delta?.text).toBe('Hello');
    });

    it('should increment block index on stop', () => {
      const state = new AnthropicStreamingState('msg-test', 'claude-3');

      state.buildContentBlockStart();
      const stop = state.buildContentBlockStop();
      expect(stop.index).toBe(0);

      // After stop, next block should have index 1
      const { event: start2 } = state.buildContentBlockStart();
      expect(start2.index).toBe(1);
    });
  });
});
