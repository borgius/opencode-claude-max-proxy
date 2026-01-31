#!/bin/bash
set -e

echo "🚀 Deploying Claude Proxy to Cloudflare Containers..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running. Please start Docker and try again."
  exit 1
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "❌ Error: wrangler is not installed. Install it with: npm install -g wrangler"
  exit 1
fi

# Extract OAuth credentials from macOS keychain
echo "📦 Extracting OAuth credentials from keychain..."
OAUTH_CREDS=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w 2>/dev/null)

if [ -z "$OAUTH_CREDS" ]; then
  echo "❌ Error: Could not find Claude Code credentials in keychain"
  echo "Please run 'claude login' first"
  exit 1
fi

# Set the secret in Cloudflare
echo "🔑 Setting OAuth credentials secret..."
echo "$OAUTH_CREDS" | wrangler secret put CLAUDE_OAUTH_CREDS

# Deploy
echo "🏗️  Building and deploying container..."
wrangler deploy

echo "✅ Deployment complete!"
echo ""
echo "Your proxy is available at:"
echo "https://opencode-claude-proxy.YOUR_ACCOUNT.workers.dev"
echo ""
echo "Test it with:"
echo "curl https://opencode-claude-proxy.YOUR_ACCOUNT.workers.dev/health"
