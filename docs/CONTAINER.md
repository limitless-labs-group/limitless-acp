# Container / GKE deployment

One image, two runnable services:

| Service                      | Command                                 | Network                | Purpose                               |
| ---------------------------- | --------------------------------------- | ---------------------- | ------------------------------------- |
| **acp-seller** (default CMD) | `node_modules/.bin/tsx src/seller.ts`   | Outbound only          | Sells offerings on Virtuals ACP       |
| **mcp-server** (optional)    | `node_modules/.bin/tsx src/mcp/http.ts` | Inbound `:3333` `/mcp` | Limitless MCP endpoint for AI clients |

```bash
docker build -t limitless-acp .
```

## Hard requirements

1. **Exactly one seller replica.** Two sellers with the same agent credentials
   race on the same jobs. Use `replicas: 1` and `strategy: type: Recreate`
   (never RollingUpdate — old and new pods overlap during a rolling update).
2. **Ledger state must persist.** The seller writes buyer-position state to
   `LEDGER_PATH` (image default `/data/ledger.json`). Mount a small PVC
   (1Gi, ReadWriteOnce) at `/data`. Seed it with the current `ledger.json`
   from the previous host at cutover.
3. **`readOnlyRootFilesystem: true` is supported as-is.** tsx needs a
   writable temp directory at startup; the entrypoint uses `/tmp` when it is
   writable and otherwise falls back to a `tmp/` directory beside the ledger
   on the data volume. Mounting an `emptyDir` at `/tmp` is still preferred
   (keeps temp files off network storage) but is not required. The image runs
   as the base image's `node` user (uid/gid 1000), matching
   `runAsUser`/`runAsGroup`/`fsGroup: 1000`.
4. **Secrets via env, never in the image.** All keys from `.env.example`;
   the sensitive ones are `PRIVATE_KEY` (hot wallet, ~$30),
   `ACP_SIGNER_PRIVATE_KEY`, `LIMITLESS_HMAC_TOKEN_ID`/`SECRET`. Use a
   Kubernetes Secret (or External Secrets). `dotenv` no-ops when no `.env`
   file exists, so plain env vars flow through.

## Uptime is discoverability

ACP search only returns **online** agents, and an agent counts as online only
while its event stream is connected. If the seller dies or silently loses the
stream, the agent disappears from the marketplace. Two safeguards are built in:

- **Start timeout** (`ACP_START_TIMEOUT_MS`, default 180000): if ACP's API is
  unreachable, `start()` would otherwise hang forever. The process exits
  non-zero instead so the supervisor retries.
- **Watchdog**: polls ACP's own view of our online status every 60s and exits
  non-zero after two consecutive confirmed-offline checks. Unreachable-API
  checks are skipped, not counted, so a network blip is not a restart.

`GET /healthz` (on `HEALTH_PORT`) returns **200** only when connected and
online, **503** otherwise, and it binds before connecting — so a hung connect
reports unhealthy rather than refusing connections. Pair it with
`restartPolicy: Always` (the default) plus a startupProbe with a generous
`failureThreshold` for the initial connect:

```yaml
startupProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  failureThreshold: 30 # allow up to ~5 min for first ACP connect
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 30
  failureThreshold: 3
```

## Environment

Seller (required): `SELLER_AGENT_WALLET_ADDRESS`, `ACP_WALLET_ID`,
`ACP_SIGNER_PRIVATE_KEY`, `PRIVATE_KEY`, `LIMITLESS_HMAC_TOKEN_ID`,
`LIMITLESS_HMAC_SECRET`.
Recommended: `BASE_RPC_URL` (dedicated Base RPC; the public default rate-limits),
`LOG_LEVEL=info`, `HEALTH_PORT=8080` (enables `GET /healthz` for probes),
`LEDGER_PATH=/data/ledger.json`.

MCP server: none required for market-data mode. `MCP_PORT` (default 3333).
Trading mode additionally needs `LIMITLESS_MCP_TRADING=true`,
`MCP_AUTH_TOKEN` (server refuses to start without it), `PRIVATE_KEY`,
`LIMITLESS_HMAC_TOKEN_ID`/`SECRET`, and optionally
`LIMITLESS_MCP_MAX_BET_USD`.

Logs are JSON on stdout (pino, `NODE_ENV=production`) — GKE Cloud Logging
picks them up as structured entries.

## Example manifests (starting point)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: acp-seller-ledger
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: acp-seller
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: { app: acp-seller }
  template:
    metadata:
      labels: { app: acp-seller }
    spec:
      containers:
        - name: seller
          image: <registry>/limitless-acp:latest
          envFrom:
            - secretRef: { name: acp-seller-env }
          env:
            - name: HEALTH_PORT
              value: "8080"
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 15
            periodSeconds: 30
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 512Mi }
          volumeMounts:
            - name: ledger
              mountPath: /data
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: ledger
          persistentVolumeClaim: { claimName: acp-seller-ledger }
        - name: tmp
          emptyDir: {}
```

MCP server (market-data mode) is stateless: same image with
`command: ["node_modules/.bin/tsx", "src/mcp/http.ts"]`, no volume, N replicas fine,
plus a Service/Ingress on port 3333 (`/healthz` for probes). Target host:
`mcp.limitless.exchange`.

## Cutover checklist

- [ ] Secret `acp-seller-env` created from the current `.env`
- [ ] PVC seeded with current `ledger.json`
- [ ] Laptop instance stopped **before** the pod starts
- [ ] Pod logs show the Limitless preflight clean + "Seller runtime is running (ACP v2)"
- [ ] One `npm run smoke:buyer` (from anywhere with requestor creds) completes a job
