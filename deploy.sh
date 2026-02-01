#!/bin/bash
set -e

echo "🚀 Deploying Claude Proxy to Cloudflare..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "❌ Error: wrangler is not installed. Install it with: npm install -g wrangler"
  exit 1
fi

# Update OAuth credentials
./update-creds.sh

# Deploy (fake docker in PATH for local deploys without Docker)
if ! docker info > /dev/null 2>&1; then
  echo "⚠️  Docker not running, using remote build..."
  mkdir -p ~/bin
  cat > ~/bin/docker << 'DOCKER_FAKE'
#!/bin/bash
if [[ "$1" == "info" ]] || [[ "$1" == "version" ]]; then
  echo '{"ServerVersion": "24.0.0"}'
  exit 0
fi
exit 0
DOCKER_FAKE
  chmod +x ~/bin/docker
  export PATH="$HOME/bin:$PATH"
fi

echo "🏗️  Building and deploying..."
wrangler deploy

echo "✅ Deployment complete!"
echo ""
echo "Your proxy is available at:"
wrangler whoami 2>&1 | grep -o 'https://[^ ]*' || echo "https://opencode-claude-max-proxy.<your-subdomain>.workers.dev"
echo ""
echo "Test with:"
echo "curl https://opencode-claude-max-proxy.<your-subdomain>.workers.dev/health"
