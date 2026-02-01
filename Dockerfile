FROM node:22-slim

# Install Claude Code CLI globally (v2.0.72 - later versions have 60s latency bug)
RUN npm install -g @anthropic-ai/claude-code@2.0.72

WORKDIR /app

# Copy the server file
COPY src/container-server.cjs ./

# Create .claude directory for credentials
RUN mkdir -p /root/.claude

EXPOSE 8080

CMD ["node", "container-server.cjs"]
