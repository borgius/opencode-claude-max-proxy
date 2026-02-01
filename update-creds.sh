#!/bin/bash
set -e

echo "🔑 Updating Claude OAuth credentials in Cloudflare..."

# Extract OAuth credentials from macOS keychain
OAUTH_CREDS=$(security find-generic-password -s "Claude Code-credentials" -a "admin" -w 2>/dev/null)

if [ -z "$OAUTH_CREDS" ]; then
  echo "❌ Error: Could not find Claude Code credentials in keychain"
  echo "Please run 'claude login' first"
  exit 1
fi

# Validate JSON
if ! echo "$OAUTH_CREDS" | jq . > /dev/null 2>&1; then
  echo "❌ Error: Invalid JSON in credentials"
  exit 1
fi

# Check for access token
ACCESS_TOKEN=$(echo "$OAUTH_CREDS" | jq -r '.claudeAiOauth.accessToken // .accessToken // empty')
if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Error: No access token found in credentials"
  exit 1
fi

SUBSCRIPTION=$(echo "$OAUTH_CREDS" | jq -r '.claudeAiOauth.subscriptionType // .subscriptionType // "unknown"')
echo "✅ Found OAuth credentials (subscription: $SUBSCRIPTION)"

# Update secret in Cloudflare
echo "📤 Uploading to Cloudflare..."
echo "$OAUTH_CREDS" | wrangler secret put CLAUDE_OAUTH_CREDS

echo "✅ Credentials updated successfully!"
