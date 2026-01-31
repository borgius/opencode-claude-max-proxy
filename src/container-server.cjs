const http = require('http');
const Anthropic = require('@anthropic-ai/sdk').default;

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

console.log(`Starting container server on ${HOST}:${PORT}`);
console.log('Node version:', process.version);

// Parse OAuth credentials safely - handles nested structure
let oauthCreds = {};
let accessToken = null;
try {
  const credsStr = process.env.CLAUDE_OAUTH_CREDS;
  if (credsStr) {
    const parsed = JSON.parse(credsStr);
    // Handle nested structure: {claudeAiOauth: {accessToken: ...}}
    if (parsed.claudeAiOauth) {
      oauthCreds = parsed.claudeAiOauth;
      accessToken = oauthCreds.accessToken;
    } else if (parsed.accessToken) {
      // Direct structure: {accessToken: ...}
      oauthCreds = parsed;
      accessToken = parsed.accessToken;
    }
    console.log('OAuth credentials loaded, subscription:', oauthCreds.subscriptionType);
  } else {
    console.warn('No CLAUDE_OAUTH_CREDS environment variable');
  }
} catch (e) {
  console.error('Failed to parse CLAUDE_OAUTH_CREDS:', e.message);
}

// Create Anthropic client with OAuth token
let anthropic = null;
if (accessToken) {
  anthropic = new Anthropic({
    apiKey: accessToken,
  });
  console.log('Anthropic client initialized');
} else {
  console.warn('No accessToken found - Anthropic client not initialized');
}

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      hasCredentials: !!oauthCreds.accessToken,
      subscription: oauthCreds.subscriptionType || 'unknown',
      nodeVersion: process.version
    }));
    return;
  }

  // Handle /v1/messages
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);

        // Try to get credentials from header if not in env
        let client = anthropic;
        if (!client) {
          const headerCreds = req.headers['x-oauth-creds'];
          if (headerCreds) {
            try {
              const parsed = JSON.parse(headerCreds);
              // Handle nested structure
              let token = null;
              if (parsed.claudeAiOauth?.accessToken) {
                token = parsed.claudeAiOauth.accessToken;
              } else if (parsed.accessToken) {
                token = parsed.accessToken;
              }
              if (token) {
                client = new Anthropic({ apiKey: token });
                console.log('Using credentials from header');
              }
            } catch (e) {
              console.error('Failed to parse header credentials:', e.message);
            }
          }
        }

        if (!client) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              type: 'authentication_error',
              message: 'Anthropic client not initialized - missing credentials'
            }
          }));
          return;
        }

        // Check if streaming is requested
        const isStreaming = requestData.stream === true;

        if (isStreaming) {
          // Streaming response
          const stream = await client.messages.create({
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
        } else {
          // Non-streaming response
          const message = await client.messages.create({
            ...requestData,
            stream: false,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(message));
        }
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            type: error.type || 'api_error',
            message: error.message
          }
        }));
      }
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    });

    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not Found' } }));
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
