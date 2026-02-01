import { defineConfig } from 'vitest/config';

/**
 * Configuration for integration/e2e tests
 * These tests make real calls to the Claude CLI and require valid credentials
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes for real API calls
    hookTimeout: 120000,
    // Run tests sequentially to avoid Claude process conflicts
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
