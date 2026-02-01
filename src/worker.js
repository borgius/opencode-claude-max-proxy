import { Container } from "@cloudflare/containers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reqId = Math.random().toString(36).substring(2, 8);

    console.log(`[${reqId}] Worker: ${request.method} ${url.pathname}`);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', platform: 'cloudflare-containers' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Route to container - handle all API paths
    // OpenAI: /v1/chat/completions, /v1/models, /v1/responses
    // Anthropic: /v1/messages, /messages, /anthropic/v1/messages
    const apiPaths = ['/v1/', '/messages', '/anthropic/'];
    if (apiPaths.some(p => url.pathname.startsWith(p))) {
      console.log(`[${reqId}] Routing to container...`);
      try {
        // Get or create Durable Object for container
        const id = env.CLAUDE_CONTAINER.idFromName('default');
        const stub = env.CLAUDE_CONTAINER.get(id);
        console.log(`[${reqId}] Got DO stub`);

        // Read body first (can only be consumed once)
        let bodyText = null;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          bodyText = await request.text();
          console.log(`[${reqId}] Body read, len=${bodyText?.length}`);
        }

        // Clone request and add OAuth creds header (secrets not accessible in DO)
        const headers = new Headers(request.headers);
        const hasOAuth = !!(env.CLAUDE_OAUTH_CREDS);
        headers.set('X-OAuth-Creds', env.CLAUDE_OAUTH_CREDS || '');
        console.log(`[${reqId}] OAuth creds set: ${hasOAuth}`);

        const modifiedRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: bodyText,
        });

        // Forward request to Durable Object which will proxy to container
        console.log(`[${reqId}] Forwarding to DO...`);
        const response = await stub.fetch(modifiedRequest);
        console.log(`[${reqId}] DO response: status=${response.status}`);
        return response;
      } catch (error) {
        console.error(`[${reqId}] Worker error:`, error.message);
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

  // Keep container warm for 5 minutes after last request (prevents cold starts)
  sleepAfter = '5m';

  // Environment variables passed to container
  envVars = {};

  // Override fetch to pass OAuth creds to container as env var
  async fetch(request) {
    const reqId = Math.random().toString(36).substring(2, 8);
    console.log(`[${reqId}] Container DO: fetch called`);

    try {
      // Get OAuth creds from header and set as env var for container
      const oauthCreds = request.headers.get('X-OAuth-Creds') || '';
      this.envVars = {
        CLAUDE_OAUTH_CREDS: oauthCreds,
        PORT: '8080'
      };
      console.log(`[${reqId}] Container DO: envVars set, oauthLen=${oauthCreds?.length}`);

      // Build the container URL
      const url = new URL(request.url);
      const containerPath = `http://container${url.pathname}${url.search}`;
      console.log(`[${reqId}] Container DO: path=${containerPath}`);

      // Forward request - keep X-OAuth-Creds header for container to read
      const forwardHeaders = new Headers(request.headers);

      // Read body for non-GET requests
      let body = null;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.text();
        console.log(`[${reqId}] Container DO: body read, len=${body?.length}`);
      }

      // Use containerFetch to forward to container
      console.log(`[${reqId}] Container DO: calling containerFetch...`);
      const startTime = Date.now();
      const response = await this.containerFetch(containerPath, {
        method: request.method,
        headers: forwardHeaders,
        body: body,
      });
      console.log(`[${reqId}] Container DO: response received in ${Date.now() - startTime}ms, status=${response.status}`);
      return response;
    } catch (error) {
      console.error(`[${reqId}] Container DO error:`, error.message, error.stack);
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
    console.log('Container: onStart called');
  }

  onStop() {
    console.log('Container: onStop called');
  }

  onError(error) {
    console.error('Container: onError:', error);
  }
}
