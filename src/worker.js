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

    try {
      // Get OAuth creds from header (passed from Worker)
      const oauthCreds = request.headers.get('X-OAuth-Creds') || '';

      // Start container if not running
      if (!container.running) {
        container.start({
          env: {
            CLAUDE_OAUTH_CREDS: oauthCreds,
            PORT: '8080'
          }
        });

        // Wait for container to be ready (up to 60 seconds)
        let attempts = 60;
        while (!container.running && attempts > 0) {
          await new Promise(r => setTimeout(r, 1000));
          attempts--;
        }

        if (!container.running) {
          return new Response(JSON.stringify({
            error: 'Container failed to start within 60 seconds'
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Get TCP port to container
      const port = container.getTcpPort(8080);

      // Forward request to container (remove internal header)
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.delete('X-OAuth-Creds');

      const containerUrl = new URL(request.url);
      containerUrl.protocol = 'http:';
      containerUrl.host = port.host;

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
        containerRunning: container?.running
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
