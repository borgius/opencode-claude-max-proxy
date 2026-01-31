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
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    // Get or create container instance
    let container = await this.state.blockConcurrencyWhile(async () => {
      let existing = this.state.getContainer();
      if (existing) return existing;

      // Spawn new container
      const newContainer = await this.env.CONTAINERS.spawn({
        env: {
          CLAUDE_OAUTH_CREDS: this.env.CLAUDE_OAUTH_CREDS,
          PORT: '8080'
        }
      });

      this.state.setContainer(newContainer);
      return newContainer;
    });

    // Forward request to container
    const containerUrl = new URL(request.url);
    containerUrl.protocol = 'http:';
    containerUrl.host = `${container.ip}:8080`;

    const containerRequest = new Request(containerUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return await fetch(containerRequest);
  }
}
