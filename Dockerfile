FROM node:22-slim

WORKDIR /app

# Copy only the server file (no npm dependencies needed)
COPY src/container-server.cjs ./

EXPOSE 8080

CMD ["node", "container-server.cjs"]
