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

log('INFO', 'Starting container server v6 (persistent process, no sessions)', { host: HOST, port: PORT });

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

// Persistent Claude process manager - NO SESSIONS
class ClaudeProcessManager {
  constructor() {
    this.process = null;
    this.readline = null;
    this.isReady = false;
    this.pendingRequest = null;
    this.requestQueue = [];
    this.lastActivity = Date.now();
    this.requestCount = 0;
  }

  async ensureProcess() {
    if (this.process && !this.process.killed) {
      log('DEBUG', 'Reusing existing Claude process', { pid: this.process.pid, requestCount: this.requestCount });
      return;
    }

    log('INFO', 'Starting new persistent Claude process (no sessions)');
    const startTime = Date.now();

    const args = [
      // No -p flag - we want interactive mode
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--no-session-persistence',  // No sessions!
    ];

    this.process = spawn('claude', args, {
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'dumb',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    log('INFO', 'Claude process spawned', { pid: this.process.pid, elapsed: Date.now() - startTime });

    this.readline = readline.createInterface({ input: this.process.stdout });

    // Handle output
    this.readline.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (e) {
        log('ERROR', 'Parse error', { line: line.slice(0, 100) });
      }
    });

    this.process.stderr.on('data', (data) => {
      log('WARN', 'stderr', { data: data.toString().slice(0, 200) });
    });

    this.process.on('close', (code) => {
      log('INFO', 'Claude process closed', { code, requestCount: this.requestCount });
      this.process = null;
      this.readline = null;
      this.isReady = false;
      // Reject pending request if any
      if (this.pendingRequest) {
        this.pendingRequest.onError(new Error(`Process exited with code ${code}`));
        this.pendingRequest = null;
      }
    });

    this.process.on('error', (err) => {
      log('ERROR', 'Process error', { error: err.message });
      if (this.pendingRequest) {
        this.pendingRequest.onError(err);
        this.pendingRequest = null;
      }
    });

    // Mark as ready immediately - don't wait for init
    this.isReady = true;
    log('INFO', 'Claude process ready', { elapsed: Date.now() - startTime });
  }

  handleMessage(msg) {
    this.lastActivity = Date.now();

    // Log system messages
    if (msg.type === 'system') {
      log('DEBUG', 'System message received', { subtype: msg.subtype || 'init' });
    }

    // Forward to pending request
    if (this.pendingRequest) {
      this.pendingRequest.onEvent(msg);

      // Check if this completes the request
      if (msg.type === 'result') {
        log('DEBUG', 'Result received, request complete', { requestCount: this.requestCount });
        const req = this.pendingRequest;
        this.pendingRequest = null;
        req.onDone(0);

        // Process next request in queue
        this.processQueue();
      }
    }
  }

  sendMessage(prompt, onEvent, onError, onDone) {
    const request = { prompt, onEvent, onError, onDone };

    if (this.pendingRequest) {
      // Queue the request
      log('DEBUG', 'Queueing request, current request in progress', { queueLength: this.requestQueue.length });
      this.requestQueue.push(request);
      return;
    }

    this.executeRequest(request);
  }

  async executeRequest(request) {
    const { prompt, onEvent, onError, onDone } = request;
    const requestId = Math.random().toString(36).substring(2, 8);
    const startTime = Date.now();

    try {
      await this.ensureProcess();

      this.pendingRequest = { onEvent, onError, onDone };
      this.requestCount++;

      const inputMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: prompt }
      });

      log('DEBUG', 'Sending message', { requestId, promptLen: prompt.length, requestCount: this.requestCount });
      this.process.stdin.write(inputMessage + '\n');
      log('DEBUG', 'Message sent', { requestId, elapsed: Date.now() - startTime });

    } catch (err) {
      log('ERROR', 'Execute request error', { requestId, error: err.message });
      onError(err);
    }
  }

  processQueue() {
    if (this.requestQueue.length > 0 && !this.pendingRequest) {
      const nextRequest = this.requestQueue.shift();
      log('DEBUG', 'Processing queued request', { queueLength: this.requestQueue.length });
      this.executeRequest(nextRequest);
    }
  }

  shutdown() {
    if (this.process) {
      log('INFO', 'Shutting down Claude process', { requestCount: this.requestCount });
      this.process.kill();
      this.process = null;
    }
  }
}

// Global process manager
const claudeManager = new ClaudeProcessManager();

const server = http.createServer(async (req, res) => {
  const reqId = Math.random().toString(36).substring(2, 8);
  const reqStart = Date.now();

  log('INFO', 'Request', { reqId, method: req.method, url: req.url });

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
      version: 'v6-persistent-no-session',
      hasCredentials: !!oauthToken,
      subscription: subscriptionType,
      processAlive: !!claudeManager.process,
      requestCount: claudeManager.requestCount,
    }));
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', chunk => body += chunk.toString());

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { messages, model, stream } = data;

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

        log('INFO', 'Processing', { reqId, msgId, stream, requestCount: claudeManager.requestCount });

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          let sentMessageStart = false;
          let sentBlockStart = false;

          claudeManager.sendMessage(
            prompt,
            (msg) => {
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
                    usage: { output_tokens: evt.usage?.output_tokens || 0 }
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
              log('ERROR', 'Stream error', { reqId, error: err.message });
              res.write(`event: error\ndata: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
              res.end();
            },
            (code) => {
              log('INFO', 'Stream done', { reqId, elapsed: Date.now() - reqStart });
              res.end();
            }
          );

        } else {
          // Non-streaming
          let text = '';
          let usage = {};

          claudeManager.sendMessage(
            prompt,
            (msg) => {
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
            (code) => {
              log('INFO', 'Non-stream done', { reqId, elapsed: Date.now() - reqStart });
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
                }
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
  log('INFO', 'Features: persistent process, no sessions');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('INFO', 'SIGTERM received, shutting down');
  claudeManager.shutdown();
  server.close();
});

process.on('SIGINT', () => {
  log('INFO', 'SIGINT received, shutting down');
  claudeManager.shutdown();
  server.close();
});

process.on('uncaughtException', (err) => log('ERROR', 'Uncaught', { error: err.message }));
process.on('unhandledRejection', (err) => log('ERROR', 'Unhandled', { error: err?.message }));
