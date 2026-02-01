/**
 * Models API Handler
 * OpenAI-compatible /v1/models endpoint
 *
 * Claude Code only supports these models:
 * - claude-opus-4-5-20251101 (Claude Opus 4.5)
 * - claude-sonnet-4-5-20250929 (Claude Sonnet 4.5)
 * - claude-haiku-4-5-20251001 (Claude Haiku 4.5)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OpenAIModel, OpenAIModelsResponse } from '../core/types.js';
import { logger } from '../core/logger.js';

/**
 * Supported Claude Code models
 */
export const CLAUDE_MODELS = {
  OPUS: 'claude-opus-4-5-20251101',
  SONNET: 'claude-sonnet-4-5-20250929',
  HAIKU: 'claude-haiku-4-5-20251001',
} as const;

/**
 * Default model when not recognized
 */
export const DEFAULT_MODEL = CLAUDE_MODELS.SONNET;

/**
 * Available Claude models via Claude Code
 */
const AVAILABLE_MODELS: OpenAIModel[] = [
  // Claude 4.5 Series (Supported by Claude Code)
  {
    id: CLAUDE_MODELS.OPUS,
    object: 'model',
    created: 1730419200, // Nov 2024
    owned_by: 'anthropic',
  },
  {
    id: CLAUDE_MODELS.SONNET,
    object: 'model',
    created: 1727568000, // Sept 2024
    owned_by: 'anthropic',
  },
  {
    id: CLAUDE_MODELS.HAIKU,
    object: 'model',
    created: 1727654400, // Oct 2024
    owned_by: 'anthropic',
  },
  // OpenAI-style aliases (for compatibility)
  {
    id: 'gpt-4o',
    object: 'model',
    created: 1727568000,
    owned_by: 'anthropic',
  },
  {
    id: 'gpt-4o-mini',
    object: 'model',
    created: 1727654400,
    owned_by: 'anthropic',
  },
  {
    id: 'gpt-4-turbo',
    object: 'model',
    created: 1727568000,
    owned_by: 'anthropic',
  },
  {
    id: 'gpt-4',
    object: 'model',
    created: 1730419200,
    owned_by: 'anthropic',
  },
  {
    id: 'gpt-3.5-turbo',
    object: 'model',
    created: 1727654400,
    owned_by: 'anthropic',
  },
  {
    id: 'o1',
    object: 'model',
    created: 1730419200,
    owned_by: 'anthropic',
  },
  {
    id: 'o1-mini',
    object: 'model',
    created: 1727654400,
    owned_by: 'anthropic',
  },
  {
    id: 'o1-preview',
    object: 'model',
    created: 1730419200,
    owned_by: 'anthropic',
  },
];

/**
 * Model ID aliases - maps any model to supported Claude Code models
 */
export const MODEL_ALIASES: Record<string, string> = {
  // OpenAI models -> Claude
  'gpt-4o': CLAUDE_MODELS.SONNET,
  'gpt-4o-mini': CLAUDE_MODELS.HAIKU,
  'gpt-4-turbo': CLAUDE_MODELS.SONNET,
  'gpt-4': CLAUDE_MODELS.OPUS,
  'gpt-3.5-turbo': CLAUDE_MODELS.HAIKU,
  'o1': CLAUDE_MODELS.OPUS,
  'o1-mini': CLAUDE_MODELS.HAIKU,
  'o1-preview': CLAUDE_MODELS.OPUS,

  // Claude model aliases
  'claude-4': CLAUDE_MODELS.SONNET,
  'claude-4-opus': CLAUDE_MODELS.OPUS,
  'claude-4-sonnet': CLAUDE_MODELS.SONNET,
  'claude-4.5': CLAUDE_MODELS.SONNET,
  'claude-4.5-opus': CLAUDE_MODELS.OPUS,
  'claude-4.5-sonnet': CLAUDE_MODELS.SONNET,
  'claude-4.5-haiku': CLAUDE_MODELS.HAIKU,

  // Old Claude models -> map to new ones
  'claude-opus-4-20250514': CLAUDE_MODELS.OPUS,
  'claude-sonnet-4-20250514': CLAUDE_MODELS.SONNET,
  'claude-3-5-sonnet-20241022': CLAUDE_MODELS.SONNET,
  'claude-3-5-sonnet-latest': CLAUDE_MODELS.SONNET,
  'claude-3-5-haiku-20241022': CLAUDE_MODELS.HAIKU,
  'claude-3-5-haiku-latest': CLAUDE_MODELS.HAIKU,
  'claude-3-opus-20240229': CLAUDE_MODELS.OPUS,
  'claude-3-opus-latest': CLAUDE_MODELS.OPUS,
  'claude-3-sonnet-20240229': CLAUDE_MODELS.SONNET,
  'claude-3-haiku-20240307': CLAUDE_MODELS.HAIKU,
  'claude-3.5-sonnet': CLAUDE_MODELS.SONNET,
  'claude-3.5-haiku': CLAUDE_MODELS.HAIKU,
  'claude-3-opus': CLAUDE_MODELS.OPUS,
  'claude-3-sonnet': CLAUDE_MODELS.SONNET,
  'claude-3-haiku': CLAUDE_MODELS.HAIKU,

  // Direct mappings (passthrough)
  [CLAUDE_MODELS.OPUS]: CLAUDE_MODELS.OPUS,
  [CLAUDE_MODELS.SONNET]: CLAUDE_MODELS.SONNET,
  [CLAUDE_MODELS.HAIKU]: CLAUDE_MODELS.HAIKU,
};

/**
 * Get list of all models
 */
export function getModels(): OpenAIModelsResponse {
  return {
    object: 'list',
    data: AVAILABLE_MODELS,
  };
}

/**
 * Get a specific model by ID
 * For aliases (like gpt-4o), returns the resolved Claude model
 */
export function getModel(modelId: string): OpenAIModel | null {
  // Check aliases first - return the resolved Claude model
  const aliasedId = MODEL_ALIASES[modelId];
  if (aliasedId) {
    return AVAILABLE_MODELS.find(m => m.id === aliasedId) || null;
  }

  // Check direct match for non-aliased models
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  if (model) return model;

  return null;
}

/**
 * Resolve model ID to a supported Claude Code model
 * Returns DEFAULT_MODEL (Sonnet) if model is not recognized
 */
export function resolveModelId(modelId: string): string {
  // Check if it's a direct match to a supported model
  if (modelId === CLAUDE_MODELS.OPUS ||
      modelId === CLAUDE_MODELS.SONNET ||
      modelId === CLAUDE_MODELS.HAIKU) {
    return modelId;
  }

  // Check aliases
  const aliasedId = MODEL_ALIASES[modelId];
  if (aliasedId) {
    return aliasedId;
  }

  // Default to Sonnet for unknown models
  logger.warn('Unknown model, defaulting to Sonnet', {
    requestedModel: modelId,
    resolvedModel: DEFAULT_MODEL
  });
  return DEFAULT_MODEL;
}

/**
 * Handle GET /v1/models
 */
export async function handleListModels(
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string
): Promise<void> {
  logger.debug('List models request', { reqId });

  const response = getModels();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

/**
 * Handle GET /v1/models/:model_id
 */
export async function handleGetModel(
  req: IncomingMessage,
  res: ServerResponse,
  modelId: string,
  reqId: string
): Promise<void> {
  logger.debug('Get model request', { reqId, modelId });

  const model = getModel(modelId);

  if (!model) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: `Model '${modelId}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(model));
}

export default {
  handleListModels,
  handleGetModel,
  getModels,
  getModel,
  resolveModelId,
  MODEL_ALIASES,
  AVAILABLE_MODELS,
  CLAUDE_MODELS,
  DEFAULT_MODEL,
};
