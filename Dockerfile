FROM node:22-slim AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev deps for building)
RUN npm install

# Copy source files
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-slim

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (required for --dangerously-skip-permissions)
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /home/claude/.claude && \
    chown -R claude:claude /home/claude

WORKDIR /app

# Copy built files from builder
COPY --from=builder /build/dist ./dist/
COPY --from=builder /build/package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Set ownership
RUN chown -R claude:claude /app

# Switch to non-root user
USER claude

EXPOSE 8080

CMD ["node", "dist/container-server.js"]
