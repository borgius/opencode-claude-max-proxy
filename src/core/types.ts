/**
 * Core type definitions for OpenAI and Anthropic API compatibility
 */

// ============================================================================
// OpenAI Chat Completions API Types
// ============================================================================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function' | 'developer';
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  function_call?: OpenAIFunctionCall;
  refusal?: string;
  audio?: OpenAIAudioOutput;
}

export interface OpenAIContentPart {
  type: 'text' | 'image_url' | 'input_audio';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
  input_audio?: {
    data: string;
    format: 'wav' | 'mp3';
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAIResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    description?: string;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAIStreamOptions {
  include_usage?: boolean;
}

export interface OpenAIAudioOutput {
  id: string;
  data: string;
  expires_at: number;
  transcript: string;
}

export interface OpenAIChatCompletionRequest {
  // Required
  model: string;
  messages: OpenAIMessage[];

  // Generation parameters
  max_tokens?: number;
  max_completion_tokens?: number;  // For reasoning models (o1, o3)
  temperature?: number;            // 0-2, default 1
  top_p?: number;                  // 0-1, default 1
  n?: number;                      // Number of completions, default 1

  // Streaming
  stream?: boolean;
  stream_options?: OpenAIStreamOptions;

  // Stop sequences
  stop?: string | string[];        // Up to 4 sequences

  // Penalties
  frequency_penalty?: number;      // -2 to 2, default 0
  presence_penalty?: number;       // -2 to 2, default 0

  // Logprobs
  logprobs?: boolean;
  top_logprobs?: number;           // 0-20

  // Bias
  logit_bias?: Record<string, number>;  // Token ID -> bias (-100 to 100)

  // Tools/Functions
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  parallel_tool_calls?: boolean;

  // Deprecated function calling
  functions?: OpenAIFunction[];
  function_call?: 'none' | 'auto' | { name: string };

  // Response format
  response_format?: OpenAIResponseFormat;

  // Reasoning (o1, o3 models)
  reasoning_effort?: 'low' | 'medium' | 'high';

  // Seed for deterministic sampling
  seed?: number;

  // Service tier
  service_tier?: 'auto' | 'default' | 'flex' | 'priority';

  // Storage and metadata
  store?: boolean;
  metadata?: Record<string, string>;

  // User tracking
  user?: string;

  // Modalities (for models with audio/vision)
  modalities?: ('text' | 'audio')[];
  audio?: {
    voice: string;
    format: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';
  };

  // Predicted output (for speculative decoding)
  prediction?: {
    type: 'content';
    content: string | OpenAIContentPart[];
  };

  // Web search (if supported)
  web_search_options?: {
    search_context_size?: 'low' | 'medium' | 'high';
    user_location?: {
      type: 'approximate';
      approximate?: {
        city?: string;
        country?: string;
        region?: string;
        timezone?: string;
      };
    };
  };
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  system_fingerprint?: string;
  service_tier?: string;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: OpenAILogprobs | null;
}

export interface OpenAILogprobs {
  content: OpenAILogprobContent[] | null;
  refusal?: OpenAILogprobContent[] | null;
}

export interface OpenAILogprobContent {
  token: string;
  logprob: number;
  bytes: number[] | null;
  top_logprobs: {
    token: string;
    logprob: number;
    bytes: number[] | null;
  }[];
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    audio_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
}

// Streaming chunk
export interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIChunkChoice[];
  usage?: OpenAIUsage | null;
  system_fingerprint?: string;
  service_tier?: string;
}

export interface OpenAIChunkChoice {
  index: number;
  delta: Partial<OpenAIMessage>;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: OpenAILogprobs | null;
}

// ============================================================================
// OpenAI Responses API Types (newer API)
// ============================================================================

export interface OpenAIResponsesRequest {
  model: string;
  input: string | OpenAIResponsesInputItem[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  metadata?: Record<string, string>;
  store?: boolean;
  include?: string[];
  previous_response_id?: string;
  truncation?: 'auto' | 'disabled';
}

export interface OpenAIResponsesInputItem {
  type: 'message' | 'item_reference';
  role?: 'user' | 'assistant' | 'system' | 'developer';
  content?: string | OpenAIContentPart[];
  id?: string;
}

export interface OpenAIResponsesResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'in_progress' | 'failed' | 'cancelled';
  model: string;
  output: OpenAIResponsesOutput[];
  usage?: OpenAIUsage;
  metadata?: Record<string, string>;
  error?: { message: string; type: string };
}

export interface OpenAIResponsesOutput {
  type: 'message';
  id: string;
  role: 'assistant';
  content: {
    type: 'output_text' | 'refusal';
    text?: string;
    annotations?: unknown[];
  }[];
  status: 'completed' | 'in_progress';
}

// ============================================================================
// OpenAI Models API Types
// ============================================================================

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface OpenAIModelsResponse {
  object: 'list';
  data: OpenAIModel[];
}

// ============================================================================
// Anthropic Messages API Types
// ============================================================================

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;

  // Optional parameters
  system?: string | AnthropicSystemBlock[];
  stop_sequences?: string[];
  temperature?: number;          // 0-1, default 1
  top_p?: number;
  top_k?: number;

  // Streaming
  stream?: boolean;

  // Tools
  tools?: AnthropicTool[];
  tool_choice?: {
    type: 'auto' | 'any' | 'tool';
    name?: string;
  };

  // Metadata
  metadata?: {
    user_id?: string;
  };
}

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: {
    type: 'ephemeral';
  };
}

export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Anthropic Streaming Events
export interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' |
        'content_block_stop' | 'message_delta' | 'message_stop' | 'ping' | 'error';
  message?: Partial<AnthropicMessagesResponse>;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
    partial_json?: string;
  };
  usage?: Partial<AnthropicUsage>;
  error?: { type: string; message: string };
}

// ============================================================================
// Claude CLI Types (stream-json protocol)
// ============================================================================

export interface ClaudeStreamMessage {
  type: 'system' | 'user' | 'assistant' | 'stream_event' | 'result';
  subtype?: string;
  message?: {
    role: string;
    content: ClaudeContentBlock[];
  };
  event?: AnthropicStreamEvent;
  usage?: AnthropicUsage;
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ClaudeInputMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export interface APIError {
  error: {
    type: 'invalid_request_error' | 'authentication_error' | 'permission_error' |
          'not_found_error' | 'rate_limit_error' | 'api_error' | 'overloaded_error';
    message: string;
    code?: string;
    param?: string;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  subscriptionType?: 'claude_max' | 'pro' | 'unknown';
  expiresAt?: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}
