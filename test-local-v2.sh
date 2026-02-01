#!/bin/bash
set -e

echo "Testing container-server-v2.cjs locally..."

# Get OAuth token from keychain
OAUTH_TOKEN=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // .accessToken // empty')
if [ -z "$OAUTH_TOKEN" ]; then
  echo "Warning: Could not get OAuth token from keychain"
fi

# Start server in background with OAuth token
echo "Starting v2 server..."
CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN" node src/container-server-v2.cjs &
SERVER_PID=$!
sleep 2

# Cleanup function
cleanup() {
  echo "Stopping server..."
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Test health endpoint
echo ""
echo "=== Testing health endpoint ==="
curl -s http://localhost:8080/health | jq .

# Test /v1/messages endpoint with timing
echo ""
echo "=== Testing /v1/messages endpoint ==="
echo "Sending request..."
START_TIME=$(date +%s%N)

RESPONSE=$(timeout 30 curl -s -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Say hi in one sentence"}]
  }')

END_TIME=$(date +%s%N)
ELAPSED=$(( (END_TIME - START_TIME) / 1000000 ))

echo "Response received in ${ELAPSED}ms:"
echo "$RESPONSE" | jq .

echo ""
echo "=== Test complete ==="
