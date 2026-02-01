const http = require('node:http');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

console.log(`Starting container server v2 (stream-json) on ${HOST}:${PORT}`);
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

// Convert messages array to a single prompt string
function messagesToPrompt(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') {
      return m.content;
    }
    // Handle content array (e.g., with images)
    if (Array.isArray(m.content)) {
      return m.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return '';
  }).join('\n\n');
}

// Run Claude CLI with stream-json protocol (much faster)
function runClaudeStreamJson(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ];

    console.log('Running claude CLI with stream-json protocol...');

    const child = spawn('claude', args, {
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'dumb',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Send the user message in stream-json format
    const inputMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: prompt
      }
    });

    child.stdin.write(inputMessage + '\n');
    child.stdin.end();

    let assistantContent = '';
    let resultData = null;
    let stderr = '';

    // Parse newline-delimited JSON from stdout
    const rl = readline.createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const msg = JSON.parse(line);

        if (msg.type === 'assistant' && msg.message?.content) {
          // Extract text from content array
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              assistantContent += block.text;
            }
          }
        } else if (msg.type === 'result') {
          resultData = msg;
        }
      } catch (e) {
        console.error('Failed to parse line:', line.slice(0, 100));
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      rl.close();

      if (code !== 0 && !assistantContent) {
        console.error('Claude CLI error:', stderr);
        reject(new Error(stderr || `Claude CLI exited with code ${code}`));
      } else {
        resolve({
          text: assistantContent || resultData?.result || '',
          usage: resultData?.usage || {},
          duration_ms: resultData?.duration_ms || 0,
        });
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
      version: 'v2-stream-json',
      hasCredentials: !!oauthToken,
      subscription: subscriptionType,
      nodeVersion: process.version,
      method: 'claude-cli-stream-json'
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
        const startTime = Date.now();

        if (stream) {
          // Streaming response - use stream-json mode and convert to SSE
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
            const result = await runClaudeStreamJson(prompt);
            const text = result.text;
            const elapsed = Date.now() - startTime;
            console.log(`Response generated in ${elapsed}ms`);

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
              usage: { output_tokens: result.usage?.output_tokens || Math.ceil(text.length / 4) }
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
            const result = await runClaudeStreamJson(prompt);
            const text = result.text;
            const elapsed = Date.now() - startTime;
            console.log(`Response generated in ${elapsed}ms`);

            const response = {
              id: generateId(),
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text }],
              model: model || 'claude-sonnet-4-20250514',
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: {
                input_tokens: result.usage?.input_tokens || Math.ceil(prompt.length / 4),
                output_tokens: result.usage?.output_tokens || Math.ceil(text.length / 4)
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
  console.log(`Container server v2 listening on ${HOST}:${PORT}`);
  console.log('Using Claude CLI with stream-json protocol');
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
