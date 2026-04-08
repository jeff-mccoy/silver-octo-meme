FROM node:22-slim

RUN apt-get update && apt-get install -y git curl build-essential gcc && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm @anthropic-ai/claude-code

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY *.mjs .

RUN mkdir -p /data /config /workspace && chown -R node:node /data /workspace
USER node
CMD ["node", "index.mjs"]
