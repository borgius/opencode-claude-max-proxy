FROM node:22-slim

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (required for --dangerously-skip-permissions)
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /home/claude/.claude && \
    chown -R claude:claude /home/claude

WORKDIR /app

# Copy the server file (v6 with persistent process, no sessions)
COPY src/container-server-v6.cjs ./container-server.cjs

# Set ownership
RUN chown -R claude:claude /app

# Switch to non-root user
USER claude

EXPOSE 8080

CMD ["node", "container-server.cjs"]
