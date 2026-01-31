export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', platform: 'cloudflare-containers' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route to container
    if (url.pathname.startsWith('/v1/')) {
      try {
        // Get or create Durable Object for container
        const id = env.CLAUDE_CONTAINER.idFromName('default');
        const stub = env.CLAUDE_CONTAINER.get(id);

        // Forward request to container
        return await stub.fetch(request);
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

export class ClaudeContainer {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const container = this.ctx.container;

    // Check what methods exist
    const methodsExist = {
      start: typeof container?.start === 'function',
      running: typeof container?.running,
      runningValue: container?.running,
      getTcpPort: typeof container?.getTcpPort === 'function',
      monitor: typeof container?.monitor === 'function',
    };

    // Try to start the container
    let startResult = null;
    let startError = null;
    try {
      if (methodsExist.start && !container.running) {
        container.start({
          env: {
            CLAUDE_OAUTH_CREDS: this.env.CLAUDE_OAUTH_CREDS || 'NOT_SET',
            PORT: '8080'
          }
        });
        startResult = 'started';
      } else if (container.running) {
        startResult = 'already running';
      }
    } catch (e) {
      startError = e.message;
    }

    return new Response(JSON.stringify({
      debug: true,
      methodsExist,
      startResult,
      startError,
      hasOAuthCreds: !!this.env.CLAUDE_OAUTH_CREDS
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
