import Anthropic from '@anthropic-ai/sdk';
import http from 'http';

// Parse OAuth credentials safely
let OAUTH_CREDS = {};
try {
  OAUTH_CREDS = JSON.parse(process.env.CLAUDE_OAUTH_CREDS || '{}');
} catch (e) {
  console.error('Failed to parse CLAUDE_OAUTH_CREDS:', e.message);
}

// Create Anthropic client with OAuth token (only if we have credentials)
let anthropic = null;
if (OAUTH_CREDS.accessToken) {
  anthropic = new Anthropic({
    apiKey: OAUTH_CREDS.accessToken,
  });
} else {
  console.warn('No accessToken found in CLAUDE_OAUTH_CREDS');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);

        if (!anthropic) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Anthropic client not initialized - missing credentials' }));
          return;
        }

        // Forward to Anthropic using SDK
        const stream = await anthropic.messages.create({
          ...requestData,
          stream: true,
        });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        for await (const event of stream) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        res.end();
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      hasCredentials: !!OAUTH_CREDS.accessToken,
      subscription: OAUTH_CREDS.subscriptionType || 'unknown'
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Bind to all interfaces explicitly
server.listen(PORT, HOST, () => {
  console.log(`Container server listening on ${HOST}:${PORT}`);
});

// Handle errors
server.on('error', (err) => {
  console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
