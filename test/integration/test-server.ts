/**
 * Common test server helper for e2e tests
 * Handles server lifecycle management with proper cleanup
 *
 * Supports testing against:
 * - Local server (default): Spins up a local server for testing
 * - Remote proxy: Set TEST_PROXY_URL env var to test against a deployed proxy
 *
 * Examples:
 *   npm run test:e2e                                    # Test local server
 *   TEST_PROXY_URL=http://localhost:8080 npm run test:e2e  # Test local proxy
 *   TEST_PROXY_URL=https://my-proxy.example.com npm run test:e2e  # Test remote
 */

import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Check if we're testing against a remote proxy
 */
export function isRemoteProxy(): boolean {
  return !!process.env.TEST_PROXY_URL;
}

/**
 * Get the remote proxy URL if configured
 */
export function getRemoteProxyUrl(): string | undefined {
  return process.env.TEST_PROXY_URL;
}

// Try to load real credentials from macOS keychain
function loadCredentialsFromKeychain(): string | null {
  try {
    const creds = execSync(
      'security find-generic-password -s "Claude Code-credentials" -a "admin" -w 2>/dev/null',
      { encoding: 'utf-8' }
    ).trim();

    if (creds) {
      const parsed = JSON.parse(creds);
      const token = parsed.claudeAiOauth?.accessToken || parsed.accessToken;
      if (token) {
        return creds;
      }
    }
  } catch {
    // Keychain access failed - use test token
  }
  return null;
}

// Load credentials once at module init (needed for both local and remote testing)
const keychainCreds = loadCredentialsFromKeychain();
let authHeaders: Record<string, string> = {};

if (keychainCreds) {
  // For remote testing, we'll send credentials in headers
  authHeaders = {
    'x-oauth-creds': keychainCreds,
  };

  // For local testing, also set environment variables
  if (!isRemoteProxy()) {
    process.env.CLAUDE_OAUTH_CREDS = keychainCreds;
    const parsed = JSON.parse(keychainCreds);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = parsed.claudeAiOauth?.accessToken || parsed.accessToken;
  }
} else if (!isRemoteProxy()) {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN || 'test-token';
}

// Suppress logs during tests
process.env.LOG_LEVEL = 'ERROR';

export interface TestServerContext {
  server: Server | null;
  baseUrl: string;
  isRemote: boolean;
  /** Headers to include in requests for authentication */
  authHeaders: Record<string, string>;
}

/**
 * Create and start a test server, or connect to a remote proxy
 * Uses dynamic import to avoid loading claudeManager until needed
 *
 * @param startClaudeProcess - Whether to start Claude process (ignored for remote)
 */
export async function createTestServer(startClaudeProcess = false): Promise<TestServerContext> {
  // If testing against a remote proxy, just return the URL
  const remoteUrl = getRemoteProxyUrl();
  if (remoteUrl) {
    console.log(`Testing against remote proxy: ${remoteUrl}`);
    return {
      server: null,
      baseUrl: remoteUrl.replace(/\/$/, ''), // Remove trailing slash if present
      isRemote: true,
      authHeaders,
    };
  }

  // Local testing: Initialize config to ensure credentials are loaded
  const { config } = await import('../../src/core/config.js');
  config.init();

  // Dynamic import to avoid loading claudeManager on module load
  const { handleRequest } = await import('../../src/server/server.js');

  const server = createServer(async (req, res) => {
    await handleRequest(req, res);
  });

  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  if (startClaudeProcess) {
    const { claudeManager } = await import('../../src/core/claude-manager.js');
    await claudeManager.ensureProcess();
  }

  // For local testing, no auth headers needed (credentials are in env)
  return { server, baseUrl, isRemote: false, authHeaders: {} };
}

/**
 * Close test server and optionally shutdown Claude process
 * No-op for remote proxy testing
 */
export async function closeTestServer(
  context: TestServerContext,
  shutdownClaude = false
): Promise<void> {
  // Nothing to close for remote proxy
  const { server } = context;
  if (context.isRemote || !server) {
    return;
  }

  // Close HTTP server
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Shutdown Claude process if requested
  if (shutdownClaude) {
    const { claudeManager } = await import('../../src/core/claude-manager.js');
    claudeManager.shutdown();
  }
}

/**
 * Get Claude manager instance - use this for tests that need it
 * Note: Not available when testing against remote proxy
 */
export async function getClaudeManager() {
  if (isRemoteProxy()) {
    throw new Error('Claude manager is not available when testing against remote proxy');
  }
  const { claudeManager } = await import('../../src/core/claude-manager.js');
  return claudeManager;
}
