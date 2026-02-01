const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

console.log(`Starting container server on ${HOST}:${PORT}`);
console.log('Node version:', process.version);

// Parse OAuth credentials and set up environment for Claude CLI
let oauthToken = null;
let subscriptionType = 'unknown';

try {
  const credsStr = process.env.CLAUDE_OAUTH_CREDS;
  if (credsStr) {
    const parsed = JSON.parse(credsStr);
    // Handle nested structure: {claudeAiOauth: {accessToken: ...}}
    if (parsed.claudeAiOauth?.accessToken) {
      oauthToken = parsed.claudeAiOauth.accessToken;
      subscriptionType = parsed.claudeAiOauth.subscriptionType || 'unknown';
    } else if (parsed.accessToken) {
      // Direct structure: {accessToken: ...}
      oauthToken = parsed.accessToken;
      subscriptionType = parsed.subscriptionType || 'unknown';
    }

    if (oauthToken) {
      // Set the env var for Claude CLI
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      console.log('OAuth token configured for Claude CLI, subscription:', subscriptionType);
    }
  }

  // Also check direct env var
  if (!oauthToken && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    console.log('Using CLAUDE_CODE_OAUTH_TOKEN from environment');
  }

  if (!oauthToken) {
    console.warn('No OAuth token available - Claude CLI will fail to authenticate');
  }
} catch (e) {
  console.error('Failed to parse CLAUDE_OAUTH_CREDS:', e.message);
}

// Convert messages array to a prompt string
function messagesToPrompt(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') {
      return `${m.role}: ${m.content}`;
    }
    // Handle content array (e.g., with images)
    if (Array.isArray(m.content)) {
      const textParts = m.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
      return `${m.role}: ${textParts}`;
    }
    return '';
  }).join('\n\n');
}

// Run Claude CLI with a prompt
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--no-session-persistence',      // Don't save sessions to disk
    ];

    console.log('Running claude CLI...');

    const child = spawn('claude', args, {
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'dumb',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('Claude CLI error:', stderr);
        reject(new Error(stderr || `Claude CLI exited with code ${code}`));
      } else {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          // If not JSON, return raw text
          resolve({ result: stdout });
        }
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Generate a unique ID
function generateId() {
  return 'msg_' + Math.random().toString(36).substring(2, 15);
}

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      hasCredentials: !!oauthToken,
      subscription: subscriptionType,
      nodeVersion: process.version,
      method: 'claude-cli'
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
        const { messages, model, max_tokens, stream } = requestData;

        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { type: 'invalid_request_error', message: 'messages array required' }
          }));
          return;
        }

        // Check for credentials from header if not in env
        if (!oauthToken) {
          const headerCreds = req.headers['x-oauth-creds'];
          if (headerCreds) {
            try {
              const parsed = JSON.parse(headerCreds);
              if (parsed.claudeAiOauth?.accessToken) {
                process.env.CLAUDE_CODE_OAUTH_TOKEN = parsed.claudeAiOauth.accessToken;
                console.log('Using OAuth token from header');
              } else if (parsed.accessToken) {
                process.env.CLAUDE_CODE_OAUTH_TOKEN = parsed.accessToken;
                console.log('Using OAuth token from header');
              }
            } catch (e) {
              console.error('Failed to parse header credentials:', e.message);
            }
          }
        }

        if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { type: 'authentication_error', message: 'No OAuth token available' }
          }));
          return;
        }

        const prompt = messagesToPrompt(messages);

        if (stream) {
          // Streaming response - use JSON mode and simulate SSE
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const msgId = generateId();

          // Send message_start event
          res.write(`event: message_start\ndata: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: msgId,
              type: 'message',
              role: 'assistant',
              content: [],
              model: model || 'claude-sonnet-4-20250514',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 }
            }
          })}\n\n`);

          // Send content_block_start
          res.write(`event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' }
          })}\n\n`);

          try {
            // Use non-streaming mode and simulate streaming with the result
            const result = await runClaude(prompt, model, max_tokens, false);
            const text = result.result || result.text || JSON.stringify(result);

            // Send the text as a single delta (simulated streaming)
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text }
            })}\n\n`);

            // Send content_block_stop
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
              type: 'content_block_stop',
              index: 0
            })}\n\n`);

            // Send message_delta with stop reason
            res.write(`event: message_delta\ndata: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: Math.ceil(text.length / 4) }
            })}\n\n`);

            // Send message_stop
            res.write(`event: message_stop\ndata: ${JSON.stringify({
              type: 'message_stop'
            })}\n\n`);

            res.end();

          } catch (error) {
            console.error('Stream error:', error);
            res.write(`event: error\ndata: ${JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: error.message }
            })}\n\n`);
            res.end();
          }

        } else {
          // Non-streaming response
          try {
            const result = await runClaude(prompt, model, max_tokens, false);
            const text = result.result || result.text || JSON.stringify(result);

            const response = {
              id: generateId(),
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text }],
              model: model || 'claude-sonnet-4-20250514',
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: {
                input_tokens: prompt.length / 4, // Rough estimate
                output_tokens: text.length / 4
              }
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));

          } catch (error) {
            console.error('Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: { type: 'api_error', message: error.message }
            }));
          }
        }

      } catch (error) {
        console.error('Parse error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { type: 'invalid_request_error', message: error.message }
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
  console.log('Using Claude CLI for API requests');
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
