# opencode-claude-proxy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/rynfar/opencode-claude-max-proxy.svg)](https://github.com/rynfar/opencode-claude-max-proxy/stargazers)

**Use your Claude Max subscription with OpenAI-compatible tools via Cloudflare Containers** - No Anthropic API credits needed!

This project deploys a serverless proxy using **Cloudflare Containers** (Docker-based) that authenticates with your Claude Max subscription, enabling you to use OpenHands, Cursor, Continue, and other OpenAI-compatible tools without purchasing separate API credits.

## Features

| Feature | Description |
|---------|-------------|
| **Full OpenAI API Compatibility** | `/v1/chat/completions` endpoint with all parameters |
| **Anthropic API Support** | `/v1/messages` endpoint for native Anthropic clients |
| **Claude Max Integration** | Uses your existing Claude Max subscription via OAuth |
| **Cloudflare Containers** | Full Docker support with Node.js + Claude CLI |
| **Streaming Support** | Real-time SSE streaming for both APIs |
| **Model Aliases** | Use `gpt-4o`, `gpt-4-turbo`, etc. - automatically mapped to Claude |
| **Tool Calling** | Full function/tool support for agentic workflows |
| **Scale-to-Zero** | Only pay when actively processing requests |

## v4.0.0 - Modular TypeScript Architecture

This version features a complete rewrite with:
- **Modular TypeScript codebase** - Clean separation of concerns
- **Full OpenAI API compatibility** - All documented parameters supported
- **Comprehensive test suite** - 117+ tests with Vitest
- **Persistent Claude process** - Faster responses with request queueing

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI Chat Completions API (full compatibility) |
| `/v1/models` | GET | List available models |
| `/v1/models/:id` | GET | Get model details |
| `/v1/messages` | POST | Anthropic Messages API |
| `/messages` | POST | Anthropic Messages API (alias) |
| `/anthropic/v1/messages` | POST | Anthropic Messages API (namespaced) |
| `/health` | GET | Detailed health check |
| `/ping` | GET | Simple liveness check |
| `/` | GET | Root health check |

## Supported OpenAI Parameters

| Parameter | Status | Notes |
|-----------|--------|-------|
| `model` | ✅ Required | Mapped to Claude models |
| `messages` | ✅ Required | Full role support (system, user, assistant, tool) |
| `stream` | ✅ Supported | SSE streaming with OpenAI chunk format |
| `temperature` | ✅ Supported | 0-2 range, scaled to Claude's 0-1 |
| `max_tokens` | ✅ Supported | - |
| `top_p` | ✅ Supported | - |
| `stop` | ✅ Supported | Stop sequences |
| `tools` | ✅ Supported | Function calling |
| `tool_choice` | ✅ Supported | auto, none, required, or specific |
| `response_format` | ✅ Supported | JSON mode |
| `reasoning_effort` | ✅ Supported | Maps to extended thinking |
| `n` | ⚠️ Validated | Only n=1 supported |
| `frequency_penalty` | ⚠️ Passthrough | Validated but limited effect |
| `presence_penalty` | ⚠️ Passthrough | Validated but limited effect |
| `seed` | ⚠️ Passthrough | For compatibility |
| `user` | ⚠️ Passthrough | For compatibility |

## Supported Claude Code Models

Claude Code only supports these three models:

| Model ID | Description |
|----------|-------------|
| `claude-opus-4-5-20251101` | Claude Opus 4.5 - Most capable |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 - Balanced (default) |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 - Fastest |

## Model Mapping

All model requests are automatically mapped to supported Claude Code models.
Unknown models default to Sonnet.

| Request Model | Maps To |
|---------------|---------|
| `gpt-4o` | `claude-sonnet-4-5-20250929` |
| `gpt-4o-mini` | `claude-haiku-4-5-20251001` |
| `gpt-4-turbo` | `claude-sonnet-4-5-20250929` |
| `gpt-4` | `claude-opus-4-5-20251101` |
| `gpt-3.5-turbo` | `claude-haiku-4-5-20251001` |
| `o1` | `claude-opus-4-5-20251101` |
| `o1-mini` | `claude-haiku-4-5-20251001` |
| `o1-preview` | `claude-opus-4-5-20251101` |
| `claude-3-5-sonnet-*` | `claude-sonnet-4-5-20250929` |
| `claude-3-5-haiku-*` | `claude-haiku-4-5-20251001` |
| `claude-3-opus-*` | `claude-opus-4-5-20251101` |
| Unknown models | `claude-sonnet-4-5-20250929` |

## Project Structure

```
src/
├── core/
│   ├── types.ts          # TypeScript types for all APIs
│   ├── logger.ts         # Structured logging with levels
│   ├── config.ts         # OAuth credentials and server config
│   └── claude-manager.ts # Persistent Claude CLI process manager
├── converters/
│   ├── messages.ts       # Message format conversions
│   └── responses.ts      # Response stream converters
├── handlers/
│   ├── openai-chat.ts    # OpenAI Chat Completions handler
│   ├── anthropic-messages.ts # Anthropic Messages handler
│   ├── models.ts         # Models listing and aliases
│   └── health.ts         # Health check endpoints
├── server/
│   ├── middleware.ts     # CORS, auth, request parsing
│   └── server.ts         # HTTP server with routing
└── container-server.ts   # Main entry point

test/
├── setup.ts              # Test utilities and mocks
├── health.test.ts        # Health endpoint tests
├── models.test.ts        # Models API tests
├── openai-chat.test.ts   # OpenAI chat tests (stream + non-stream)
├── anthropic-messages.test.ts # Anthropic tests (stream + non-stream)
├── converters.test.ts    # Converter tests
└── server.test.ts        # Middleware tests
```

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

Your proxy will be available at: `https://opencode-claude-proxy.<your-account>.workers.dev`

## Development

### Build

```bash
npm run build
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

### Type Check

```bash
npm run typecheck
```

## Usage Examples

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://opencode-claude-proxy.<account>.workers.dev/v1",
    api_key="dummy"  # Not validated
)

response = client.chat.completions.create(
    model="gpt-4o",  # Mapped to claude-sonnet-4
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

### OpenAI SDK (Node.js)

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
    baseURL: 'https://opencode-claude-proxy.<account>.workers.dev/v1',
    apiKey: 'dummy'
});

const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true
});

for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Anthropic SDK

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="https://opencode-claude-proxy.<account>.workers.dev",
    api_key="dummy"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(message.content[0].text)
```

### OpenHands

```bash
export LLM_BASE_URL=https://opencode-claude-proxy.<account>.workers.dev
export LLM_API_KEY=dummy
export LLM_MODEL=gpt-4o

openhands
```

### Cursor

In Cursor settings, configure:
- API Base URL: `https://opencode-claude-proxy.<account>.workers.dev/v1`
- API Key: `dummy`
- Model: `gpt-4o`

### cURL

```bash
# OpenAI format
curl -X POST https://opencode-claude-proxy.<account>.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Anthropic format
curl -X POST https://opencode-claude-proxy.<account>.workers.dev/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client Applications                   │
│  (OpenHands, Cursor, Continue, custom apps)             │
└─────────────────────────┬───────────────────────────────┘
                          │ OpenAI or Anthropic API
                          v
┌─────────────────────────────────────────────────────────┐
│               Cloudflare Worker (Edge)                   │
│               - Request routing                          │
│               - Durable Object management                │
└─────────────────────────┬───────────────────────────────┘
                          │
                          v
┌─────────────────────────────────────────────────────────┐
│           Durable Object (State Manager)                 │
│           - Container lifecycle                          │
│           - Request forwarding                           │
└─────────────────────────┬───────────────────────────────┘
                          │
                          v
┌─────────────────────────────────────────────────────────┐
│                  Docker Container                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │              HTTP Server (Port 8080)             │    │
│  │  - OpenAI endpoint: /v1/chat/completions        │    │
│  │  - Anthropic endpoint: /v1/messages             │    │
│  │  - Models endpoint: /v1/models                  │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Claude Manager (Persistent)            │    │
│  │  - Claude CLI process with stream-json          │    │
│  │  - Request queueing                              │    │
│  │  - OAuth authentication                          │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────┘
                          │
                          v
┌─────────────────────────────────────────────────────────┐
│                    Anthropic API                         │
│                  (Claude Max Auth)                       │
└─────────────────────────────────────────────────────────┘
```

## Configuration

### Container Settings (wrangler.toml)

```toml
[[containers]]
name = "CONTAINERS"
image = "./Dockerfile"
instance_type = "standard-2"  # Adjust based on needs
max_instances = 5              # Max concurrent containers
```

### Environment Variables

Set via Cloudflare secrets:

| Secret | Description |
|--------|-------------|
| `CLAUDE_OAUTH_CREDS` | OAuth credentials JSON from keychain |
| `PROXY_API_KEY` | Optional: Require API key for proxy access |

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- health.test.ts
```

Test coverage includes:
- Health endpoints (4 tests)
- Models API (15 tests)
- OpenAI Chat Completions (19 tests)
- Anthropic Messages (18 tests)
- Message/Response converters (40 tests)
- Server middleware (21 tests)

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

### "Docker not running"
Ensure Docker Desktop is running:
```bash
docker info
```

### Token expired
1. Run `npx claude login` again
2. Re-deploy: `npm run deploy`

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed troubleshooting.

## Cost Breakdown

| Service | Cost |
|---------|------|
| Cloudflare Workers Paid | $5/month |
| Container runtime | Scale-to-zero (pay per use) |
| Claude Max | Your existing subscription |

**Total additional cost**: ~$5-10/month depending on usage

## Security

- OAuth credentials stored as **encrypted Cloudflare secrets**
- Containers are **isolated** and managed by Cloudflare
- Optional `PROXY_API_KEY` secret to require authentication
- Credentials never exposed in logs or code
- Sensitive data masked in logging

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request

## Support

- Issues: [GitHub Issues](https://github.com/rynfar/opencode-claude-max-proxy/issues)
- Discussions: [GitHub Discussions](https://github.com/rynfar/opencode-claude-max-proxy/discussions)

## License

MIT

## Credits

- Built with [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- Uses [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) with stream-json protocol
- Powered by [Claude Max](https://claude.ai)
