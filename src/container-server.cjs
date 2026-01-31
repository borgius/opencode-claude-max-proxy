const http = require('node:http');
const https = require('node:https');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

console.log(`Starting container server on ${HOST}:${PORT}`);
console.log('Node version:', process.version);

// Parse OAuth credentials safely - handles nested structure
let oauthCreds = {};
let accessToken = null;
let refreshToken = null;
try {
  const credsStr = process.env.CLAUDE_OAUTH_CREDS;
  if (credsStr) {
    const parsed = JSON.parse(credsStr);
    // Handle nested structure: {claudeAiOauth: {accessToken: ...}}
    if (parsed.claudeAiOauth) {
      oauthCreds = parsed.claudeAiOauth;
      accessToken = oauthCreds.accessToken;
      refreshToken = oauthCreds.refreshToken;
    } else if (parsed.accessToken) {
      // Direct structure: {accessToken: ...}
      oauthCreds = parsed;
      accessToken = parsed.accessToken;
      refreshToken = parsed.refreshToken;
    }
    console.log('OAuth credentials loaded, subscription:', oauthCreds.subscriptionType);
  } else {
    console.warn('No CLAUDE_OAUTH_CREDS environment variable');
  }
} catch (e) {
  console.error('Failed to parse CLAUDE_OAUTH_CREDS:', e.message);
}

// Make API request with Bearer auth (OAuth tokens need Bearer, not x-api-key)
async function makeAnthropicRequest(token, requestData, isStreaming) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(requestData);

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      if (isStreaming) {
        resolve(res);
      } else {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, data });
        });
      }
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      hasCredentials: !!accessToken,
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
        let token = accessToken;
        if (!token) {
          const headerCreds = req.headers['x-oauth-creds'];
          if (headerCreds) {
            try {
              const parsed = JSON.parse(headerCreds);
              if (parsed.claudeAiOauth?.accessToken) {
                token = parsed.claudeAiOauth.accessToken;
              } else if (parsed.accessToken) {
                token = parsed.accessToken;
              }
              console.log('Using credentials from header');
            } catch (e) {
              console.error('Failed to parse header credentials:', e.message);
            }
          }
        }

        if (!token) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              type: 'authentication_error',
              message: 'No OAuth token available'
            }
          }));
          return;
        }

        // Check if streaming is requested
        const isStreaming = requestData.stream === true;

        if (isStreaming) {
          // Streaming response
          const apiRes = await makeAnthropicRequest(token, { ...requestData, stream: true }, true);

          res.writeHead(apiRes.statusCode, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          apiRes.on('data', (chunk) => {
            res.write(chunk);
          });

          apiRes.on('end', () => {
            res.end();
          });

          apiRes.on('error', (err) => {
            console.error('Stream error:', err);
            res.end();
          });
        } else {
          // Non-streaming response
          const result = await makeAnthropicRequest(token, { ...requestData, stream: false }, false);

          res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
          res.end(result.data);
        }
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            type: 'api_error',
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
