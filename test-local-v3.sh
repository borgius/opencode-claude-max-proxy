#!/bin/bash
set -e

echo "Testing container-server-v3.cjs (true streaming) locally..."

# Get OAuth token from keychain
OAUTH_TOKEN=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // .accessToken // empty')
if [ -z "$OAUTH_TOKEN" ]; then
  echo "Warning: Could not get OAuth token from keychain"
fi

# Kill any existing server
pkill -f "node src/container-server" 2>/dev/null || true
sleep 1

# Start server in background with OAuth token
echo "Starting v3 server..."
CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN" node src/container-server-v3.cjs &
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

# Test streaming
echo ""
echo "=== Testing TRUE STREAMING (watch tokens arrive in real-time) ==="
echo "Sending request..."

# Use curl to show streaming response in real-time
curl -sN -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 200,
    "stream": true,
    "messages": [{"role": "user", "content": "Count from 1 to 10, one number per line"}]
  }' | while read -r line; do
  if [[ "$line" == data:* ]]; then
    echo "$line" | sed 's/data: //' | jq -r '.delta.text // .message.content[0].text // empty' 2>/dev/null || true
  fi
done

echo ""
echo "=== Test non-streaming with timing ==="
START_TIME=$(date +%s%N)

RESPONSE=$(timeout 30 curl -s -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
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
