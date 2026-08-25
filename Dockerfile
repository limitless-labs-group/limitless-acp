FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# Ledger state lives on a mounted volume in containerized runs.
ENV LEDGER_PATH=/data/ledger.json

# The base image's `node` user is uid/gid 1000, matching the runAsUser /
# runAsGroup / fsGroup used in the Kubernetes deployment.
RUN mkdir -p /data && chown node:node /data
USER node

# Invoke tsx directly rather than through npx so no npm cache write is needed
# under a read-only root filesystem. tsx still needs a writable TMPDIR: mount
# an emptyDir at /tmp when readOnlyRootFilesystem is enabled.
# Override the command to run the MCP server instead:
#   ["node_modules/.bin/tsx", "src/mcp/http.ts"]
CMD ["node_modules/.bin/tsx", "src/seller.ts"]
