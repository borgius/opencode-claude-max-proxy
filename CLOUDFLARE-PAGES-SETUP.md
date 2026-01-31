# Cloudflare Pages Setup for Remote Docker Builds

Since you don't have Docker locally, we'll use Cloudflare Pages' CI/CD to build the Docker image remotely (just like moltworker does).

## Setup Steps

### 1. Connect GitHub to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages**
3. Click **Create application** → **Pages** → **Connect to Git**
4. Authorize Cloudflare to access your GitHub account
5. Select repository: `rynfar/opencode-claude-max-proxy`
6. Configure build settings:
   - **Production branch**: `main`
   - **Build command**: `npm run deploy:manual`
   - **Build output directory**: Leave empty (Workers deployment)
   - **Root directory**: `/`

### 2. Set Environment Variables

In the Cloudflare Pages project settings, add:

- `CLAUDE_OAUTH_CREDS`: (Get from keychain - see below)

To get the OAuth credentials:
```bash
security find-generic-password -s "Claude Code-credentials" -a "admin" -w
```

### 3. Trigger Deployment

Push changes to main branch:
```bash
git add -A
git commit -m "feat: add Cloudflare Containers support"
git push origin main
```

Cloudflare Pages will:
1. Clone your repository
2. Install dependencies (`npm ci`)
3. Run build command
4. **Build Docker image remotely** (no local Docker needed!)
5. Push image to Cloudflare Registry
6. Deploy Worker + Container

## How It Works

When you push to GitHub:

```
GitHub Push
    ↓
Cloudflare Pages Build Environment
    ├─ Install Node.js
    ├─ npm ci
    ├─ wrangler deploy
    │   ├─ Build Docker image (remotely!)
    │   ├─ Push to Cloudflare Registry
    │   └─ Deploy Worker + Containers
    ↓
Deployment Complete
```

The key is that Cloudflare's build environment **has Docker installed**, so `wrangler deploy` can build the image there.

## Alternative: Manual GitHub Actions

If you prefer GitHub Actions instead of Cloudflare Pages:

1. Use the `.github/workflows/build-and-deploy.yml` we created
2. Add `CLOUDFLARE_API_TOKEN` to GitHub Secrets
3. Push to trigger the workflow

## Monitoring

Once connected, every push to `main` triggers:
- Automatic build (view logs in Cloudflare dashboard)
- Automatic deployment
- Container provisioning

View logs at:
```
https://dash.cloudflare.com → Workers & Pages → opencode-claude-proxy → Deployments
```

## Testing After Deployment

```bash
# Get your deployment URL from the dashboard
curl https://opencode-claude-proxy.pages.dev/health

# Test with a message
curl -X POST https://opencode-claude-proxy.pages.dev/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Cost

- Cloudflare Pages: Free (500 builds/month)
- Workers Paid Plan: $5/month (for Containers)
- Container runtime: Scale-to-zero pricing

Total: ~$5-10/month

## Notes

- First deployment takes 3-5 minutes
- Subsequent deploys are faster (cached layers)
- Containers provision in 2-3 minutes on first request
- Auto-scales to zero when idle
