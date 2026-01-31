import Anthropic from '@anthropic-ai/sdk';
import http from 'http';

// OAuth credentials from environment
const OAUTH_CREDS = JSON.parse(process.env.CLAUDE_OAUTH_CREDS || '{}');

// Create Anthropic client with OAuth token
const anthropic = new Anthropic({
  apiKey: OAUTH_CREDS.accessToken,
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);

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
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', subscription: OAUTH_CREDS.subscriptionType }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Container server listening on port ${PORT}`);
});
