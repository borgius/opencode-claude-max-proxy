// Simple HTTP server to test container connectivity
import http from 'http';

console.log('Starting container server...');
console.log('Node version:', process.version);
console.log('PORT env:', process.env.PORT);

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);

  // Health check - respond to everything for now
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'healthy',
    method: req.method,
    url: req.url,
    nodeVersion: process.version,
    hasOAuthCreds: !!process.env.CLAUDE_OAUTH_CREDS,
    port: PORT
  }));
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(PORT, HOST, () => {
  console.log(`Container server listening on ${HOST}:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
