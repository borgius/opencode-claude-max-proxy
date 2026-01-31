FROM node:22-slim

WORKDIR /app

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-agent-sdk

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY src ./src

# Expose port for container communication
EXPOSE 8080

CMD ["node", "src/container-server.js"]
