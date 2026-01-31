FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY src/container-server.cjs ./

EXPOSE 8080

CMD ["node", "container-server.cjs"]
