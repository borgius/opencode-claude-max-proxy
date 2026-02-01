const http = require('node:http');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Simple logger with timestamps
function log(level, msg, data = null) {
  const ts = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

log('INFO', 'Starting container server v3 (true streaming)', { host: HOST, port: PORT });
log('INFO', 'Node version', { version: process.version });

// Parse OAuth credentials
let oauthToken = null;
let subscriptionType = 'unknown';

log('INFO', 'Parsing OAuth credentials...');
log('DEBUG', 'Environment vars', {
  hasClaude_OAUTH_CREDS: !!process.env.CLAUDE_OAUTH_CREDS,
  hasCLAUDE_CODE_OAUTH_TOKEN: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
});

try {
  const credsStr = process.env.CLAUDE_OAUTH_CREDS;
  if (credsStr) {
    log('DEBUG', 'CLAUDE_OAUTH_CREDS length', { len: credsStr.length });
    const parsed = JSON.parse(credsStr);
    if (parsed.claudeAiOauth?.accessToken) {
      oauthToken = parsed.claudeAiOauth.accessToken;
      subscriptionType = parsed.claudeAiOauth.subscriptionType || 'unknown';
      log('INFO', 'OAuth token from CLAUDE_OAUTH_CREDS (nested)', { subscription: subscriptionType, tokenLen: oauthToken.length });
    } else if (parsed.accessToken) {
      oauthToken = parsed.accessToken;
      subscriptionType = parsed.subscriptionType || 'unknown';
      log('INFO', 'OAuth token from CLAUDE_OAUTH_CREDS (direct)', { subscription: subscriptionType, tokenLen: oauthToken.length });
    }

    if (oauthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    }
  }

  if (!oauthToken && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    log('INFO', 'Using CLAUDE_CODE_OAUTH_TOKEN from environment', { tokenLen: oauthToken.length });
  }

  if (!oauthToken) {
    log('WARN', 'No OAuth token available at startup');
  }
} catch (e) {
  log('ERROR', 'Failed to parse credentials', { error: e.message });
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
  const requestId = Math.random().toString(36).substring(2, 8);
  const startTime = Date.now();

  log('INFO', 'Starting Claude CLI', { requestId, promptLen: prompt.length });

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
  ];

  log('DEBUG', 'Spawning claude', { requestId, args: args.join(' ') });

  const child = spawn('claude', args, {
    env: {
      ...process.env,
      CI: 'true',
      TERM: 'dumb',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  log('DEBUG', 'Claude process spawned', { requestId, pid: child.pid });

  // Send user message
  const inputMessage = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt }
  });
  child.stdin.write(inputMessage + '\n');
  child.stdin.end();
  log('DEBUG', 'Input message sent', { requestId });

  const rl = readline.createInterface({ input: child.stdout });
  let eventCount = 0;
  let firstEventTime = null;

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      eventCount++;
      if (!firstEventTime) {
        firstEventTime = Date.now();
        log('INFO', 'First event received', { requestId, elapsed: firstEventTime - startTime, type: msg.type });
      }
      if (msg.type === 'result') {
        log('INFO', 'Result received', { requestId, elapsed: Date.now() - startTime, eventCount });
      }
      onEvent(msg);
    } catch (e) {
      log('ERROR', 'JSON parse error', { requestId, line: line.slice(0, 100) });
    }
  });

  child.stderr.on('data', (data) => {
    log('WARN', 'Claude stderr', { requestId, data: data.toString().slice(0, 200) });
  });

  child.on('close', (code) => {
    const elapsed = Date.now() - startTime;
    log('INFO', 'Claude process closed', { requestId, code, elapsed, eventCount });
    rl.close();
    onDone(code);
  });

  child.on('error', (err) => {
    log('ERROR', 'Claude process error', { requestId, error: err.message });
    onError(err);
  });

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
  const reqId = Math.random().toString(36).substring(2, 8);
  const reqStart = Date.now();

  log('INFO', 'Request received', { reqId, method: req.method, url: req.url });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    log('DEBUG', 'OPTIONS request', { reqId });
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/') {
    log('DEBUG', 'Health check', { reqId, hasOAuth: !!oauthToken });
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
      log('DEBUG', 'Request body received', { reqId, bodyLen: body.length });

      try {
        const { messages, model, stream } = JSON.parse(body);
        log('INFO', 'Parsed request', { reqId, messageCount: messages?.length, model, stream });

        if (!messages || !Array.isArray(messages)) {
          log('WARN', 'Invalid request - no messages', { reqId });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'messages array required' } }));
          return;
        }

        // Handle header credentials
        if (!oauthToken) {
          const headerCreds = req.headers['x-oauth-creds'];
          log('DEBUG', 'Checking header credentials', { reqId, hasHeaderCreds: !!headerCreds, headerLen: headerCreds?.length });
          if (headerCreds) {
            try {
              const parsed = JSON.parse(headerCreds);
              const token = parsed.claudeAiOauth?.accessToken || parsed.accessToken;
              if (token) {
                process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
                log('INFO', 'OAuth token set from header', { reqId, tokenLen: token.length });
              }
            } catch (e) {
              log('ERROR', 'Failed to parse header creds', { reqId, error: e.message });
            }
          }
        }

        if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
          log('ERROR', 'No OAuth token available', { reqId });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'No OAuth token' } }));
          return;
        }

        const prompt = messagesToPrompt(messages);
        const msgId = generateId();
        const modelName = model || 'claude-sonnet-4-20250514';
        log('INFO', 'Processing request', { reqId, msgId, promptLen: prompt.length, stream });

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
              log('ERROR', 'Stream error', { reqId, error: err.message, elapsed: Date.now() - reqStart });
              res.write(`event: error\ndata: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
              res.end();
            },
            () => {
              log('INFO', 'Stream completed', { reqId, elapsed: Date.now() - reqStart });
              res.end();
            }
          );

        } else {
          // Non-streaming
          log('INFO', 'Non-streaming request starting', { reqId });
          try {
            const result = await runClaudeNonStreaming(prompt);
            log('INFO', 'Non-streaming completed', { reqId, elapsed: Date.now() - reqStart, textLen: result.text?.length });
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
            log('ERROR', 'Non-streaming error', { reqId, elapsed: Date.now() - reqStart, error: error.message });
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

server.on('error', (err) => log('ERROR', 'Server error', { error: err.message }));

server.listen(PORT, HOST, () => {
  log('INFO', 'Server started', { host: HOST, port: PORT });
  log('INFO', 'Using true streaming with include-partial-messages');
});

process.on('uncaughtException', (err) => log('ERROR', 'Uncaught exception', { error: err.message, stack: err.stack }));
process.on('unhandledRejection', (err) => log('ERROR', 'Unhandled rejection', { error: err?.message, stack: err?.stack }));
