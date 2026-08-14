FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# Ledger state lives on a mounted volume in containerized runs.
ENV LEDGER_PATH=/data/ledger.json

RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /data && chown app:app /data
USER app

# Default: ACP seller daemon. Override the command to run the MCP server:
#   ["npx", "tsx", "src/mcp/http.ts"]
CMD ["npx", "tsx", "src/seller.ts"]
