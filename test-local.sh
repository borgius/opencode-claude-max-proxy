#!/bin/bash
set -e

echo "🧪 Testing Claude Proxy locally..."

# Extract OAuth credentials from macOS keychain
OAUTH_CREDS=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w 2>/dev/null)

if [ -z "$OAUTH_CREDS" ]; then
  echo "❌ Error: Could not find Claude Code credentials in keychain"
  echo "Please run 'claude login' first"
  exit 1
fi

echo "✅ OAuth credentials found"

# Export for the server
export CLAUDE_OAUTH_CREDS="$OAUTH_CREDS"

# Start server in background
echo "🚀 Starting container server..."
node src/container-server.cjs &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "❌ Server failed to start"
  exit 1
fi

echo "✅ Server running on http://localhost:8080"

# Test health endpoint
echo ""
echo "📋 Testing /health endpoint..."
curl -s http://localhost:8080/health | jq .

# Test API with 20s timeout
echo ""
echo "📋 Testing /v1/messages endpoint (20s timeout)..."
RESPONSE=$(curl -s --max-time 20 -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Say hello in one word"}]
  }' 2>&1) || true

echo "Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

# Cleanup
echo ""
echo "🧹 Cleaning up..."
kill $SERVER_PID 2>/dev/null || true

echo "✅ Test complete!"
