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

    // Start container on first request
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.container.start({
        env: {
          CLAUDE_OAUTH_CREDS: env.CLAUDE_OAUTH_CREDS,
          PORT: '8080'
        }
      });
    });
  }

  async fetch(request) {
    // Get TCP port to container
    const port = this.ctx.container.getTcpPort(8080);

    // Forward request to container
    const containerUrl = new URL(request.url);
    containerUrl.protocol = 'http:';
    containerUrl.host = port.host;

    const containerRequest = new Request(containerUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return await fetch(containerRequest);
  }
}
