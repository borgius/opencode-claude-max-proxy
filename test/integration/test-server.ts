/**
 * Common test server helper for e2e tests
 * Handles server lifecycle management with proper cleanup
 */

import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { execSync } from 'node:child_process';

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

// Set up test environment before any imports
// Try to use real credentials from keychain, fall back to test-token
const keychainCreds = loadCredentialsFromKeychain();
if (keychainCreds) {
  process.env.CLAUDE_OAUTH_CREDS = keychainCreds;
  // Parse and set the access token directly
  const parsed = JSON.parse(keychainCreds);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = parsed.claudeAiOauth?.accessToken || parsed.accessToken;
} else {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN || 'test-token';
}
process.env.LOG_LEVEL = 'ERROR'; // Suppress logs during tests

export interface TestServerContext {
  server: Server;
  baseUrl: string;
}

/**
 * Create and start a test server
 * Uses dynamic import to avoid loading claudeManager until needed
 */
export async function createTestServer(startClaudeProcess = false): Promise<TestServerContext> {
  // Initialize config to ensure credentials are loaded
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

  return { server, baseUrl };
}

/**
 * Close test server and optionally shutdown Claude process
 */
export async function closeTestServer(
  context: TestServerContext,
  shutdownClaude = false
): Promise<void> {
  // Close HTTP server
  await new Promise<void>((resolve, reject) => {
    context.server.close((err) => {
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
 */
export async function getClaudeManager() {
  const { claudeManager } = await import('../../src/core/claude-manager.js');
  return claudeManager;
}
