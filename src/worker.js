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

        // Clone request and add OAuth creds header (secrets not accessible in DO)
        const headers = new Headers(request.headers);
        headers.set('X-OAuth-Creds', env.CLAUDE_OAUTH_CREDS || '');

        const modifiedRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
        });

        // Forward request to container
        return await stub.fetch(modifiedRequest);
      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message,
          stack: error.stack
        }), {
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
    this.initError = null;

    // Check if container exists during construction
    try {
      this.hasContainer = !!ctx.container;
    } catch (e) {
      this.initError = e.message;
    }
  }

  async fetch(request) {
    // Return init error if any
    if (this.initError) {
      return new Response(JSON.stringify({
        error: 'Constructor error',
        initError: this.initError
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const container = this.ctx.container;

      // Debug: return container state
      if (request.url.includes('debug=1')) {
        return new Response(JSON.stringify({
          hasContainer: this.hasContainer,
          containerRunning: container?.running,
          containerMethods: container ? Object.getOwnPropertyNames(Object.getPrototypeOf(container)) : []
        }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get OAuth creds from header
      const oauthCreds = request.headers.get('X-OAuth-Creds') || '';

      // Debug: Check container state
      const isRunning = container.running;

      // Start container if needed
      if (!isRunning) {
        container.start({
          env: {
            CLAUDE_OAUTH_CREDS: oauthCreds,
            PORT: '8080'
          }
        });

        // Wait for container to be ready
        for (let i = 0; i < 60; i++) {
          if (container.running) break;
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Check if running now
      if (!container.running) {
        return new Response(JSON.stringify({
          error: 'Container not running after 60s wait'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get TCP socket to container
      const socket = container.getTcpPort(8080);

      // Build URL for container
      const containerUrl = new URL(request.url);
      containerUrl.protocol = 'http:';
      containerUrl.host = socket.host;

      // Forward request (remove internal header)
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.delete('X-OAuth-Creds');

      const containerRequest = new Request(containerUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: request.body,
      });

      return await fetch(containerRequest);

    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack,
        containerExists: !!this.ctx?.container,
        containerRunning: this.ctx?.container?.running
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
