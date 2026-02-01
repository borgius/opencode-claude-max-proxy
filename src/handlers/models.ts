/**
 * Models API Handler
 * OpenAI-compatible /v1/models endpoint
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OpenAIModel, OpenAIModelsResponse } from '../core/types.js';
import { logger } from '../core/logger.js';

/**
 * Available Claude models via Claude Max subscription
 */
const AVAILABLE_MODELS: OpenAIModel[] = [
  // Claude 4 Series (Latest)
  {
    id: 'claude-opus-4-20250514',
    object: 'model',
    created: 1715731200, // May 2025
    owned_by: 'anthropic',
  },
  {
    id: 'claude-sonnet-4-20250514',
    object: 'model',
    created: 1715731200,
    owned_by: 'anthropic',
  },
  // Claude 3.5 Series
  {
    id: 'claude-3-5-sonnet-20241022',
    object: 'model',
    created: 1729555200,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    object: 'model',
    created: 1729555200,
    owned_by: 'anthropic',
  },
  // Claude 3 Series
  {
    id: 'claude-3-opus-20240229',
    object: 'model',
    created: 1709164800,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-3-sonnet-20240229',
    object: 'model',
    created: 1709164800,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-3-haiku-20240307',
    object: 'model',
    created: 1709769600,
    owned_by: 'anthropic',
  },
  // Aliases
  {
    id: 'claude-3-5-sonnet-latest',
    object: 'model',
    created: 1729555200,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-3-5-haiku-latest',
    object: 'model',
    created: 1729555200,
    owned_by: 'anthropic',
  },
  {
    id: 'claude-3-opus-latest',
    object: 'model',
    created: 1709164800,
    owned_by: 'anthropic',
  },
];

/**
 * Model ID aliases for mapping
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Short aliases
  'claude-4': 'claude-sonnet-4-20250514',
  'claude-4-opus': 'claude-opus-4-20250514',
  'claude-4-sonnet': 'claude-sonnet-4-20250514',
  'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',

  // OpenAI-style aliases (for compatibility)
  'gpt-4o': 'claude-sonnet-4-20250514',
  'gpt-4': 'claude-3-opus-20240229',
  'gpt-4-turbo': 'claude-3-5-sonnet-20241022',
  'gpt-3.5-turbo': 'claude-3-haiku-20240307',
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
 */
export function getModel(modelId: string): OpenAIModel | null {
  // Check direct match
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  if (model) return model;

  // Check aliases
  const aliasedId = MODEL_ALIASES[modelId];
  if (aliasedId) {
    return AVAILABLE_MODELS.find(m => m.id === aliasedId) || null;
  }

  return null;
}

/**
 * Resolve model ID (handle aliases)
 */
export function resolveModelId(modelId: string): string {
  return MODEL_ALIASES[modelId] || modelId;
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
};
