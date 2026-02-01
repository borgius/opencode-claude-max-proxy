const http = require('node:http');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Simple logger
function log(level, msg, data = null) {
  const ts = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

log('INFO', 'Starting container server v4 (sessions + streaming)', { host: HOST, port: PORT });

// Parse OAuth credentials
let oauthToken = null;
let subscriptionType = 'unknown';

try {
  const credsStr = process.env.CLAUDE_OAUTH_CREDS;
  if (credsStr) {
    const parsed = JSON.parse(credsStr);
    oauthToken = parsed.claudeAiOauth?.accessToken || parsed.accessToken;
    subscriptionType = parsed.claudeAiOauth?.subscriptionType || parsed.subscriptionType || 'unknown';
    if (oauthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      log('INFO', 'OAuth configured', { subscription: subscriptionType });
    }
  }
  if (!oauthToken && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    log('INFO', 'Using CLAUDE_CODE_OAUTH_TOKEN');
  }
} catch (e) {
  log('ERROR', 'Credential parse error', { error: e.message });
}

function messagesToPrompt(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    }
    return '';
  }).join('\n\n');
}

function generateId() {
  return 'msg_' + Math.random().toString(36).substring(2, 15);
}

function generateSessionId() {
  // Generate UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Run Claude with session support
function runClaudeStreaming(prompt, options, onEvent, onError, onDone) {
  const { sessionId, resumeSession } = options;
  const requestId = Math.random().toString(36).substring(2, 8);
  const startTime = Date.now();

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ];

  // Session handling
  if (resumeSession && sessionId) {
    args.push('--resume', sessionId);
    log('INFO', 'Resuming session', { requestId, sessionId });
  } else if (sessionId) {
    args.push('--session-id', sessionId);
    log('INFO', 'Using session ID', { requestId, sessionId });
  } else {
    args.push('--no-session-persistence');
    log('INFO', 'No session (ephemeral)', { requestId });
  }

  log('DEBUG', 'Spawning claude', { requestId, args: args.slice(0, 10).join(' ') });

  const child = spawn('claude', args, {
    env: {
      ...process.env,
      CI: 'true',
      TERM: 'dumb',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  log('DEBUG', 'Process spawned', { requestId, pid: child.pid });

  const inputMessage = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt }
  });
  child.stdin.write(inputMessage + '\n');
  child.stdin.end();

  const rl = readline.createInterface({ input: child.stdout });
  let eventCount = 0;
  let actualSessionId = sessionId;

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      eventCount++;

      // Capture session_id from system init
      if (msg.type === 'system' && msg.session_id) {
        actualSessionId = msg.session_id;
      }

      if (eventCount === 1) {
        log('INFO', 'First event', { requestId, elapsed: Date.now() - startTime, type: msg.type });
      }
      if (msg.type === 'result') {
        log('INFO', 'Result', { requestId, elapsed: Date.now() - startTime, eventCount, sessionId: actualSessionId });
      }

      // Add session_id to result
      msg._sessionId = actualSessionId;
      onEvent(msg);
    } catch (e) {
      log('ERROR', 'Parse error', { requestId, line: line.slice(0, 100) });
    }
  });

  child.stderr.on('data', (data) => {
    log('WARN', 'stderr', { requestId, data: data.toString().slice(0, 200) });
  });

  child.on('close', (code) => {
    log('INFO', 'Process closed', { requestId, code, elapsed: Date.now() - startTime, eventCount });
    rl.close();
    onDone(code, actualSessionId);
  });

  child.on('error', (err) => {
    log('ERROR', 'Process error', { requestId, error: err.message });
    onError(err);
  });

  return child;
}

const server = http.createServer(async (req, res) => {
  const reqId = Math.random().toString(36).substring(2, 8);
  const reqStart = Date.now();

  log('INFO', 'Request', { reqId, method: req.method, url: req.url });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, x-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      version: 'v4-sessions',
      hasCredentials: !!oauthToken,
      subscription: subscriptionType,
    }));
    return;
  }

  // Session info endpoint
  if (req.url === '/v1/sessions' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      session_id: generateSessionId(),
      note: 'Use this session_id in requests to maintain conversation context'
    }));
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', chunk => body += chunk.toString());

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { messages, model, stream, session_id, resume_session } = data;

        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'messages array required' } }));
          return;
        }

        // Handle credentials from header
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

        // Session options
        const sessionOptions = {
          sessionId: session_id || req.headers['x-session-id'],
          resumeSession: resume_session === true || req.headers['x-resume-session'] === 'true'
        };

        log('INFO', 'Processing', { reqId, msgId, stream, sessionId: sessionOptions.sessionId, resume: sessionOptions.resumeSession });

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          let sentMessageStart = false;
          let sentBlockStart = false;
          let totalText = '';
          let responseSessionId = sessionOptions.sessionId;

          runClaudeStreaming(
            prompt,
            sessionOptions,
            (msg) => {
              if (msg._sessionId) responseSessionId = msg._sessionId;

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
                    },
                    session_id: responseSessionId
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
                    usage: { output_tokens: evt.usage?.output_tokens || 0 },
                    session_id: responseSessionId
                  })}\n\n`);
                }

                if (evt.type === 'message_stop') {
                  res.write(`event: message_stop\ndata: ${JSON.stringify({
                    type: 'message_stop',
                    session_id: responseSessionId
                  })}\n\n`);
                }
              }
            },
            (err) => {
              log('ERROR', 'Stream error', { reqId, error: err.message });
              res.write(`event: error\ndata: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
              res.end();
            },
            (code, finalSessionId) => {
              log('INFO', 'Stream done', { reqId, elapsed: Date.now() - reqStart, sessionId: finalSessionId });
              res.end();
            }
          );

        } else {
          // Non-streaming
          let text = '';
          let usage = {};
          let responseSessionId = sessionOptions.sessionId;

          runClaudeStreaming(
            prompt,
            sessionOptions,
            (msg) => {
              if (msg._sessionId) responseSessionId = msg._sessionId;
              if (msg.type === 'assistant' && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === 'text') text += block.text;
                }
              }
              if (msg.type === 'result') usage = msg.usage || {};
            },
            (err) => {
              log('ERROR', 'Non-stream error', { reqId, error: err.message });
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: err.message } }));
            },
            (code, finalSessionId) => {
              log('INFO', 'Non-stream done', { reqId, elapsed: Date.now() - reqStart, sessionId: finalSessionId });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                id: msgId,
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text }],
                model: modelName,
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: {
                  input_tokens: usage?.input_tokens || 0,
                  output_tokens: usage?.output_tokens || 0
                },
                session_id: finalSessionId
              }));
            }
          );
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not Found' } }));
});

server.on('error', (err) => log('ERROR', 'Server error', { error: err.message }));

server.listen(PORT, HOST, () => {
  log('INFO', 'Server started', { host: HOST, port: PORT });
  log('INFO', 'Features: streaming, sessions');
});

process.on('uncaughtException', (err) => log('ERROR', 'Uncaught', { error: err.message }));
process.on('unhandledRejection', (err) => log('ERROR', 'Unhandled', { error: err?.message }));
