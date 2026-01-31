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
  }

  async fetch(request) {
    try {
      const container = this.ctx.container;

      // Debug endpoint
      if (request.url.includes('debug=1')) {
        return new Response(JSON.stringify({
          containerRunning: container?.running,
          containerMethods: container ? Object.getOwnPropertyNames(Object.getPrototypeOf(container)) : []
        }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get OAuth creds from header
      const oauthCreds = request.headers.get('X-OAuth-Creds') || '';

      // Start container if not running
      if (!container.running) {
        container.start({
          env: {
            CLAUDE_OAUTH_CREDS: oauthCreds,
            PORT: '8080'
          }
        });

        // Short wait (max 10 seconds to avoid timeout)
        for (let i = 0; i < 10; i++) {
          if (container.running) break;
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // If still not running, return retry response
      if (!container.running) {
        return new Response(JSON.stringify({
          error: 'Container is starting, please retry in a few seconds',
          status: 'starting',
          retryAfter: 5
        }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '5'
          }
        });
      }

      // Get TCP socket to container
      let socket;
      try {
        socket = container.getTcpPort(8080);
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'getTcpPort failed',
          message: e.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Build URL for container
      const containerUrl = new URL(request.url);
      containerUrl.protocol = 'http:';
      containerUrl.host = socket.host;

      // Forward request (remove internal header)
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.delete('X-OAuth-Creds');

      // Clone body for POST requests
      let body = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.text();
      }

      const containerRequest = new Request(containerUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: body,
      });

      try {
        return await fetch(containerRequest);
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Container fetch failed',
          message: e.message,
          containerUrl: containerUrl.toString(),
          socketHost: socket.host
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack,
        containerRunning: this.ctx?.container?.running
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
