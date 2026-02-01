/**
 * Container Server Entry Point
 * Main entry point for the Docker container
 */

import { createServer, setupGracefulShutdown } from './server/server.js';
import { logger, setLogLevel } from './core/logger.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO') as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Set log level
setLogLevel(LOG_LEVEL);

logger.info('Starting container server', {
  version: 'v7-modular',
  port: PORT,
  host: HOST,
  logLevel: LOG_LEVEL,
  nodeVersion: process.version,
});

// Create and start server
const server = createServer({ port: PORT, host: HOST });

// Setup graceful shutdown
setupGracefulShutdown(server);

export default server;
