# opencode-claude-proxy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/rynfar/opencode-claude-max-proxy.svg)](https://github.com/rynfar/opencode-claude-max-proxy/stargazers)

**Use your Claude Max subscription with OpenHands via Cloudflare Containers** - No Anthropic API credits needed!

This project deploys a serverless proxy using **Cloudflare Containers** (Docker-based) that authenticates with your Claude Max subscription, enabling you to use OpenHands and other tools without purchasing separate API credits.

## Features

| Feature | Description |
|---------|-------------|
| **Claude Max Integration** | Uses your existing Claude Max subscription via OAuth |
| **Cloudflare Containers** | Full Docker support with Node.js + Claude SDK |
| **Serverless & Scale-to-Zero** | Only pay when actively processing requests |
| **Global Edge Deployment** | Low latency worldwide |
| **Streaming support** | Real-time SSE streaming |
| **No API Credits Needed** | Leverage your Claude Max subscription |

## Prerequisites

1. **Claude Max subscription** - Active subscription with CLI access
2. **Cloudflare Workers Paid plan** - Required for Containers ($5/month)
3. **Docker** installed and running - `docker info` should work
4. **Node.js** 18+ installed
5. **macOS** (for keychain credential extraction) or manual credential management

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/rynfar/opencode-claude-max-proxy
cd opencode-claude-max-proxy
npm install
```

### 2. Authenticate with Claude CLI

```bash
npx claude login
```

This stores OAuth credentials in your macOS keychain.

### 3. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 4. Deploy

```bash
npm run deploy
```

The deploy script will:
- Extract OAuth credentials from your keychain
- Upload them as encrypted Cloudflare secrets
- Build the Docker container
- Deploy to Cloudflare Containers

Your proxy will be available at: `https://opencode-claude-proxy.<your-account>.workers.dev`

## Detailed Setup

See [DEPLOYMENT.md](./DEPLOYMENT.md) for:
- Manual deployment steps
- Configuration options
- Instance type selection
- Troubleshooting
- Security best practices

## Usage with OpenHands

Configure OpenHands to use your proxy:

```bash
export LLM_BASE_URL=https://opencode-claude-proxy.<your-account>.workers.dev
export LLM_API_KEY=dummy  # Not validated
export LLM_MODEL=claude-sonnet-4-20250514

# Start OpenHands
openhands
```

Or add to your OpenHands config file:

```yaml
llm:
  base_url: https://opencode-claude-proxy.<your-account>.workers.dev
  api_key: dummy
  model: claude-sonnet-4-20250514
```

## Architecture

```
┌─────────────┐
│  OpenHands  │
│   Request   │
└──────┬──────┘
       │
       v
┌─────────────────────────────────┐
│   Cloudflare Worker (Edge)      │
│   - Request routing             │
│   - Durable Object management   │
└──────────────┬──────────────────┘
               │
               v
┌──────────────────────────────────┐
│  Durable Object (State Manager)  │
│  - Container lifecycle           │
│  - Request forwarding            │
└──────────────┬───────────────────┘
               │
               v
┌───────────────────────────────────┐
│   Docker Container                │
│   - Node.js + Claude SDK          │
│   - OAuth credentials (encrypted) │
│   - HTTP server on port 8080      │
└──────────────┬────────────────────┘
               │
               v
┌──────────────────────────┐
│   Anthropic API          │
│   (Claude Max Auth)      │
└──────────────────────────┘
```

## How It Works

1. **Request arrives** at Cloudflare Worker edge location
2. **Worker spawns/reuses** a Durable Object to manage container state
3. **Durable Object starts** a Docker container if needed (or reuses existing)
4. **Container authenticates** with Anthropic using your Claude Max OAuth credentials
5. **Response streams** back through the chain to OpenHands

Containers automatically **scale to zero** when idle, saving costs.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/messages` | POST | Anthropic Messages API (compatible) |

## Configuration

### Environment Variables (Container)

Set via Cloudflare secrets:

| Secret | Description | How to Set |
|--------|-------------|------------|
| `CLAUDE_OAUTH_CREDS` | OAuth credentials JSON from keychain | Auto-set by deploy script |

### Container Settings (wrangler.toml)

```toml
[[containers]]
name = "CONTAINERS"
image = "./Dockerfile"
instance_type = "standard-2"  # Adjust based on needs
max_instances = 5              # Max concurrent containers
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for all instance types and configuration options.

## Cost Breakdown

### Cloudflare
- **Workers Paid Plan**: $5/month (required for Containers)
- **Container runtime**: Scale-to-zero pricing (only pay when running)
- **Storage**: Minimal (container images)

### Claude
- **Claude Max**: Your existing subscription (no additional API costs!)

**Total additional cost**: ~$5-10/month depending on usage

## Testing

```bash
# Health check
curl https://opencode-claude-proxy.<account>.workers.dev/health

# Send a message
curl -X POST https://opencode-claude-proxy.<account>.workers.dev/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## Monitoring

```bash
# View live logs
npm run tail

# List running containers
npm run containers:list

# View container images
npm run containers:images
```

## Troubleshooting

### "Container not ready"
Wait 2-3 minutes after first deployment for container provisioning.

### "Authentication error"
Re-run the deployment script to refresh OAuth credentials:
```bash
npm run deploy
```

Or manually update the secret:
```bash
OAUTH_CREDS=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w)
echo "$OAUTH_CREDS" | wrangler secret put CLAUDE_OAUTH_CREDS
```

### "Docker not running"
Ensure Docker Desktop is running:
```bash
docker info
```

### Container crashes
Check logs for errors:
```bash
npm run tail
```

### Token expired
The OAuth credentials include a refresh token. If you see persistent auth errors:
1. Run `npx claude login` again
2. Re-deploy: `npm run deploy`

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed troubleshooting.

## Why Cloudflare Containers?

Unlike traditional Cloudflare Workers (JavaScript/WASM only), **Cloudflare Containers** allows running full Docker containers, which enables:

- Running the Claude CLI and Node.js SDK
- Persistent OAuth authentication
- Full filesystem access
- Any programming language/runtime
- Existing Docker images

This is perfect for integrating with Claude Max since the OAuth tokens can't be used directly with the Messages API.

## Alternatives Considered

| Approach | Issue |
|----------|-------|
| Direct OAuth API calls | OAuth tokens don't work with `/v1/messages` endpoint |
| AI Gateway with API key | Requires purchasing Anthropic API credits separately |
| Local proxy | Must keep computer running 24/7 |
| VPS deployment | More expensive and complex |
| **Cloudflare Containers** | ✅ Serverless, cost-effective, uses Claude Max |

## Security

- OAuth credentials stored as **encrypted Cloudflare secrets**
- Containers are **isolated** and managed by Cloudflare
- Add `PROXY_API_KEY` secret to require authentication for your proxy
- Credentials never exposed in logs or code

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## Support

- Issues: [GitHub Issues](https://github.com/rynfar/opencode-claude-max-proxy/issues)
- Discussions: [GitHub Discussions](https://github.com/rynfar/opencode-claude-max-proxy/discussions)

## License

MIT

## Credits

- Built with [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- Uses [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk)
- Powered by [Claude Max](https://claude.ai)
