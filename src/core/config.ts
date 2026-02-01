/**
 * Configuration management
 */

import type { OAuthCredentials, ServerConfig } from './types.js';
import { logger } from './logger.js';

let oauthCredentials: OAuthCredentials | null = null;
let serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: '0.0.0.0',
  logLevel: 'INFO',
};

/**
 * Parse OAuth credentials from environment or header
 */
export function parseOAuthCredentials(source?: string): OAuthCredentials | null {
  const credsStr = source || process.env.CLAUDE_OAUTH_CREDS;

  if (!credsStr) {
    // Fallback to direct token
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) {
      return { accessToken: token, subscriptionType: 'unknown' };
    }
    return null;
  }

  try {
    const parsed = JSON.parse(credsStr);

    // Handle nested structure
    if (parsed.claudeAiOauth) {
      return {
        accessToken: parsed.claudeAiOauth.accessToken,
        refreshToken: parsed.claudeAiOauth.refreshToken,
        subscriptionType: parsed.claudeAiOauth.subscriptionType || 'unknown',
        expiresAt: parsed.claudeAiOauth.expiresAt,
      };
    }

    // Handle flat structure
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      subscriptionType: parsed.subscriptionType || 'unknown',
      expiresAt: parsed.expiresAt,
    };
  } catch (err) {
    logger.error('Failed to parse OAuth credentials', { error: (err as Error).message });
    return null;
  }
}

/**
 * Initialize configuration from environment
 */
export function initConfig(): void {
  // Parse OAuth credentials
  oauthCredentials = parseOAuthCredentials();

  if (oauthCredentials) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthCredentials.accessToken;
    logger.info('OAuth configured', { subscription: oauthCredentials.subscriptionType });
  } else {
    logger.warn('No OAuth credentials found');
  }

  // Parse log level
  const logLevel = process.env.LOG_LEVEL as ServerConfig['logLevel'];
  if (logLevel && ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(logLevel)) {
    serverConfig.logLevel = logLevel;
    logger.setLogLevel(logLevel);
  }
}

/**
 * Get current OAuth credentials
 */
export function getCredentials(): OAuthCredentials | null {
  return oauthCredentials;
}

/**
 * Set OAuth credentials (e.g., from request header)
 */
export function setCredentials(creds: OAuthCredentials): void {
  oauthCredentials = creds;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = creds.accessToken;
}

/**
 * Update credentials from request header
 */
export function updateCredentialsFromHeader(headerValue: string | undefined): boolean {
  if (!headerValue) return false;

  const creds = parseOAuthCredentials(headerValue);
  if (creds) {
    setCredentials(creds);
    return true;
  }
  return false;
}

/**
 * Get server configuration
 */
export function getServerConfig(): ServerConfig {
  return serverConfig;
}

/**
 * Check if OAuth is configured
 */
export function hasValidCredentials(): boolean {
  return !!oauthCredentials?.accessToken || !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

export const config = {
  init: initConfig,
  getCredentials,
  setCredentials,
  hasValidCredentials,
  getServerConfig,
  updateCredentialsFromHeader,
  parseOAuthCredentials,
};

export default config;
