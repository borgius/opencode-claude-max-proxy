const http = require('node:http');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

console.log(`Starting container server v3 (true streaming) on ${HOST}:${PORT}`);
console.log('Node version:', process.version);

// Parse OAuth credentials
let oauthToken = null;
let subscriptionType = 'unknown';

try {
  const credsStr = process.env.CLAUDE_OAUTH_CREDS;
  if (credsStr) {
    const parsed = JSON.parse(credsStr);
    if (parsed.claudeAiOauth?.accessToken) {
      oauthToken = parsed.claudeAiOauth.accessToken;
      subscriptionType = parsed.claudeAiOauth.subscriptionType || 'unknown';
    } else if (parsed.accessToken) {
      oauthToken = parsed.accessToken;
      subscriptionType = parsed.subscriptionType || 'unknown';
    }

    if (oauthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      console.log('OAuth token configured, subscription:', subscriptionType);
    }
  }

  if (!oauthToken && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    console.log('Using CLAUDE_CODE_OAUTH_TOKEN from environment');
  }

  if (!oauthToken) {
    console.warn('No OAuth token available');
  }
} catch (e) {
  console.error('Failed to parse credentials:', e.message);
}

// Convert messages to prompt
function messagesToPrompt(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    }
    return '';
  }).join('\n\n');
}

// Generate unique ID
function generateId() {
  return 'msg_' + Math.random().toString(36).substring(2, 15);
}

// Run Claude with true streaming via stream-json + include-partial-messages
function runClaudeStreaming(prompt, onEvent, onError, onDone) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
  ];

  const child = spawn('claude', args, {
    env: {
      ...process.env,
      CI: 'true',
      TERM: 'dumb',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Send user message
  const inputMessage = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt }
  });
  child.stdin.write(inputMessage + '\n');
  child.stdin.end();

  const rl = readline.createInterface({ input: child.stdout });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      onEvent(msg);
    } catch (e) {
      console.error('Parse error:', line.slice(0, 100));
    }
  });

  child.stderr.on('data', (data) => {
    console.error('stderr:', data.toString());
  });

  child.on('close', (code) => {
    rl.close();
    onDone(code);
  });

  child.on('error', onError);

  return child;
}

// Non-streaming version for simple requests
function runClaudeNonStreaming(prompt) {
  return new Promise((resolve, reject) => {
    let text = '';
    let usage = {};

    runClaudeStreaming(
      prompt,
      (msg) => {
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') text += block.text;
          }
        }
        if (msg.type === 'result') {
          usage = msg.usage || {};
        }
      },
      reject,
      (code) => {
        if (code !== 0 && !text) {
          reject(new Error(`Exit code ${code}`));
        } else {
          resolve({ text, usage });
        }
      }
    );
  });
}

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      version: 'v3-true-streaming',
      hasCredentials: !!oauthToken,
      subscription: subscriptionType,
      nodeVersion: process.version,
    }));
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', chunk => body += chunk.toString());

    req.on('end', async () => {
      try {
        const { messages, model, stream } = JSON.parse(body);

        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'messages array required' } }));
          return;
        }

        // Handle header credentials
        if (!oauthToken) {
          const headerCreds = req.headers['x-oauth-creds'];
          if (headerCreds) {
            try {
              const parsed = JSON.parse(headerCreds);
              const token = parsed.claudeAiOauth?.accessToken || parsed.accessToken;
              if (token) process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
            } catch {}
          }
        }

        if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'No OAuth token' } }));
          return;
        }

        const prompt = messagesToPrompt(messages);
        const msgId = generateId();
        const modelName = model || 'claude-sonnet-4-20250514';

        if (stream) {
          // TRUE STREAMING - forward events as they arrive
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          let sentMessageStart = false;
          let sentBlockStart = false;
          let totalText = '';

          runClaudeStreaming(
            prompt,
            (msg) => {
              // Handle stream events
              if (msg.type === 'stream_event' && msg.event) {
                const evt = msg.event;

                if (evt.type === 'message_start' && !sentMessageStart) {
                  sentMessageStart = true;
                  res.write(`event: message_start\ndata: ${JSON.stringify({
                    type: 'message_start',
                    message: {
                      id: msgId,
                      type: 'message',
                      role: 'assistant',
                      content: [],
                      model: modelName,
                      stop_reason: null,
                      stop_sequence: null,
                      usage: evt.message?.usage || { input_tokens: 0, output_tokens: 0 }
                    }
                  })}\n\n`);
                }

                if (evt.type === 'content_block_start' && !sentBlockStart) {
                  sentBlockStart = true;
                  res.write(`event: content_block_start\ndata: ${JSON.stringify({
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' }
                  })}\n\n`);
                }

                if (evt.type === 'content_block_delta' && evt.delta?.text) {
                  totalText += evt.delta.text;
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: evt.delta.text }
                  })}\n\n`);
                }

                if (evt.type === 'content_block_stop') {
                  res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                    type: 'content_block_stop',
                    index: 0
                  })}\n\n`);
                }

                if (evt.type === 'message_delta') {
                  res.write(`event: message_delta\ndata: ${JSON.stringify({
                    type: 'message_delta',
                    delta: { stop_reason: evt.delta?.stop_reason || 'end_turn', stop_sequence: null },
                    usage: { output_tokens: evt.usage?.output_tokens || Math.ceil(totalText.length / 4) }
                  })}\n\n`);
                }

                if (evt.type === 'message_stop') {
                  res.write(`event: message_stop\ndata: ${JSON.stringify({
                    type: 'message_stop'
                  })}\n\n`);
                }
              }
            },
            (err) => {
              res.write(`event: error\ndata: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
              res.end();
            },
            () => {
              res.end();
            }
          );

        } else {
          // Non-streaming
          try {
            const result = await runClaudeNonStreaming(prompt);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: msgId,
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: result.text }],
              model: modelName,
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: {
                input_tokens: result.usage?.input_tokens || 0,
                output_tokens: result.usage?.output_tokens || 0
              }
            }));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: error.message } }));
          }
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    });

    req.on('error', (error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not Found' } }));
});

server.on('error', (err) => console.error('Server error:', err));

server.listen(PORT, HOST, () => {
  console.log(`Container server v3 listening on ${HOST}:${PORT}`);
  console.log('Using true streaming with include-partial-messages');
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
