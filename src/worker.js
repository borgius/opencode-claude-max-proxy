import { Container } from "@cloudflare/containers";

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

        // Read body first (can only be consumed once)
        let bodyText = null;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          bodyText = await request.text();
        }

        // Clone request and add OAuth creds header (secrets not accessible in DO)
        const headers = new Headers(request.headers);
        headers.set('X-OAuth-Creds', env.CLAUDE_OAUTH_CREDS || '');

        const modifiedRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: bodyText,
        });

        // Forward request to Durable Object which will proxy to container
        return await stub.fetch(modifiedRequest);
      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message,
          stack: error.stack,
          location: 'main worker'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Extend Container class
export class ClaudeContainer extends Container {
  // Set the default port that the container listens on
  defaultPort = 8080;

  // Environment variables passed to container
  envVars = {};

  // Override fetch to pass OAuth creds to container as env var
  async fetch(request) {
    try {
      // Get OAuth creds from header and set as env var for container
      const oauthCreds = request.headers.get('X-OAuth-Creds') || '';
      this.envVars = {
        CLAUDE_OAUTH_CREDS: oauthCreds,
        PORT: '8080'
      };

      // Build the container URL
      const url = new URL(request.url);
      const containerPath = `http://container${url.pathname}${url.search}`;

      // Forward request - keep X-OAuth-Creds header for container to read
      const forwardHeaders = new Headers(request.headers);

      // Read body for non-GET requests
      let body = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.text();
      }

      // Use containerFetch to forward to container
      return await this.containerFetch(containerPath, {
        method: request.method,
        headers: forwardHeaders,
        body: body,
      });
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

  onStart() {
    console.log('Container started');
  }

  onStop() {
    console.log('Container stopped');
  }

  onError(error) {
    console.error('Container error:', error);
  }
}
