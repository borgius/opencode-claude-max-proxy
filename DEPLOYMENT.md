# Cloudflare Containers Deployment Guide

This project uses **Cloudflare Containers** (in open beta) to run a Docker container with the Claude CLI/SDK, enabling you to use your Claude Max subscription via a serverless proxy.

## Architecture

```
User Request
    ↓
Cloudflare Worker (edge)
    ↓
Durable Object (manages container lifecycle)
    ↓
Docker Container (Node.js + Claude SDK + OAuth credentials)
    ↓
Anthropic API (authenticated with Claude Max)
```

## Prerequisites

1. **Cloudflare Workers Paid Plan** - Containers require a paid plan
2. **Docker installed and running** - Check with `docker info`
3. **Wrangler CLI** - Install with `npm install -g wrangler`
4. **Claude CLI logged in** - Run `claude login` if not already logged in

## Deployment Steps

### 1. Authenticate with Cloudflare

```bash
wrangler login
```

### 2. Deploy using the script

```bash
./deploy.sh
```

The script will:
- Extract OAuth credentials from your macOS keychain
- Set them as a Cloudflare secret
- Build the Docker container
- Deploy to Cloudflare

### 3. Get your deployment URL

After deployment, Wrangler will show your URL:
```
https://opencode-claude-proxy.YOUR_ACCOUNT.workers.dev
```

## Manual Deployment

If you prefer manual steps:

```bash
# 1. Extract credentials
OAUTH_CREDS=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w)

# 2. Set secret
echo "$OAUTH_CREDS" | wrangler secret put CLAUDE_OAUTH_CREDS

# 3. Deploy
wrangler deploy
```

## Configuration

### Instance Types

Edit `wrangler.toml` to change container resources:

```toml
[[containers]]
name = "CONTAINERS"
image = "./Dockerfile"
instance_type = "standard-2"  # 1 vCPU, 6 GiB, 12 GB disk
max_instances = 5
```

Available instance types:
- `lite`: 1/16 vCPU, 256 MiB, 2 GB disk
- `basic`: 1/4 vCPU, 1 GiB, 4 GB disk
- `standard-1`: 1/2 vCPU, 4 GiB, 8 GB disk
- `standard-2`: 1 vCPU, 6 GiB, 12 GB disk (current)
- `standard-3`: 2 vCPU, 8 GiB, 16 GB disk
- `standard-4`: 4 vCPU, 12 GiB, 20 GB disk

### Max Instances

Control concurrent container instances:

```toml
max_instances = 5  # Max 5 containers running at once
```

## OAuth Token Refresh

The OAuth credentials include a refresh token. To update:

```bash
# Re-extract from keychain
OAUTH_CREDS=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w)

# Update secret
echo "$OAUTH_CREDS" | wrangler secret put CLAUDE_OAUTH_CREDS
```

The access token expires, but the refresh token should automatically renew it. If you see auth errors, try the above steps.

## Testing

```bash
# Health check
curl https://opencode-claude-proxy.YOUR_ACCOUNT.workers.dev/health

# Test message
curl -X POST https://opencode-claude-proxy.YOUR_ACCOUNT.workers.dev/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Using with OpenHands

Update your OpenHands configuration:

```bash
LLM_BASE_URL=https://opencode-claude-proxy.YOUR_ACCOUNT.workers.dev
LLM_API_KEY=dummy  # Not checked
LLM_MODEL=claude-sonnet-4-20250514
```

## Monitoring

```bash
# List containers
wrangler containers list

# View logs
wrangler tail

# Check container images
wrangler containers images list
```

## Costs

Cloudflare Containers pricing (scale-to-zero):
- Only pay for container runtime
- No charges when idle
- Workers Paid plan: $5/month base

Claude Max subscription:
- Uses your existing subscription
- No additional API costs

## Limits (Open Beta)

- **Per account**: 400 GiB RAM, 100 vCPU, 2 TB disk total
- **Per instance**: Up to 12 GiB RAM, 4 vCPU, 20 GB disk
- **Image storage**: 50 GB per account

## Troubleshooting

### "Container not ready"
Wait 2-3 minutes after first deployment for provisioning.

### "Authentication error"
Re-extract and update OAuth credentials (see above).

### "Docker not running"
Start Docker Desktop and wait for it to be ready.

### Container crashes
Check logs with `wrangler tail` and verify the OAuth credentials are valid.

## Security Notes

- OAuth credentials are stored as Cloudflare secrets (encrypted)
- Containers are isolated and managed by Cloudflare
- Add proxy authentication if exposing publicly (set PROXY_API_KEY secret)

## Next Steps

- Add request authentication in the Worker
- Implement token refresh logic in container
- Add R2 bucket mounting for persistent state
- Monitor usage and adjust instance types
