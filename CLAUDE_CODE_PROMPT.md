# Claude Code Prompt — Limitless ACP Integration

## Context

You are building a persistent ACP (Agent Commerce Protocol) seller service that exposes Limitless prediction market capabilities on the Virtuals Protocol marketplace. Read `BUILD_PLAN.md` for the full architecture and spec.

## What's already done

- Project setup: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore` — dependencies are installed
- ACP infrastructure: `src/acpTypes.ts`, `src/acpSocket.ts`, `src/acpApi.ts`, `src/acpClient.ts`, `src/acpConfig.ts`, `src/logger.ts`
- Limitless SDK (adapted from `agents-starter/` reference repo): `src/limitless/types.ts`, `markets.ts`, `trading.ts`, `sign.ts`, `redeem.ts`, `portfolio.ts`, `approve.ts`, `wallet.ts`
- Offering loader: `src/offeringLoader.ts`
- Position ledger: `src/ledger.ts`

## What needs to be built

### 1. Main seller entrypoint — `src/seller.ts`

Persistent daemon that:
- Loads env, ACP API key, gets agent info via `getMyAgentInfo()` from `src/acpApi.ts`
- Initializes Limitless clients using `PRIVATE_KEY`
- Lists available offerings from `src/offerings/`
- Connects to ACP WebSocket via `connectAcpSocket()` from `src/acpSocket.ts`
- Handles `onNewTask` events routing to offering handlers
- PID management via `src/acpConfig.ts` (check existing, write PID, cleanup on exit)

The `handleNewTask` function should follow the pattern in `openclaw-acp/src/seller/runtime/seller.ts` (reference repo, don't modify it):
- REQUEST phase: parse offering name from negotiation memo, validate requirements, accept/reject, request payment
- TRANSACTION phase: load offering, execute handler, deliver result
- Pass `JobContext` (jobId, clientAddress, providerAddress, price) as second arg to `executeJob`

The offering name and requirements are extracted from the negotiation memo JSON: `{ name: "offering_name", requirement: { ... } }`.

### 2. Four offerings in `src/offerings/`

Each offering has `offering.json` (config) and `handlers.ts` (logic). See `BUILD_PLAN.md` for the exact JSON schemas and handler specs.

**`browse_markets`** — Fixed fee $0.01, no funds. Searches/lists active Limitless markets using `LimitlessClient`. Returns market summaries (slug, title, prices, volume, expiry).

**`place_bet`** — Percentage fee 2%, requires funds. Buyer sends USDC via `requestAdditionalFunds` to the trading wallet (`getWallet().account.address`). Handler calls `TradingClient.createOrder()`, records position in ledger via `addPosition()`. Must call `ensureMarketApproved()` before first trade on each venue. USDC address on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

**`get_portfolio`** — Fixed fee $0.01, no funds. Reads positions from ledger for the requesting buyer (`context.clientAddress`), enriches with current market prices from `LimitlessClient`.

**`redeem_winnings`** — Fixed fee $0.05, no funds in, but returns USDC to buyer via `payableDetail` in `ExecuteJobResult`. Uses `RedeemClient` to claim on-chain, updates ledger, returns proceeds.

### 3. Approve script — `src/scripts/approve.ts`

Simple CLI script: takes a market slug as argv, calls `ensureMarketApproved(slug)`. For manual pre-approval of venues.

### 4. Dockerfile

Node 20 alpine, copy source, install deps, run `npx tsx src/seller.ts`.

## Key types to use

From `src/acpTypes.ts`:
- `JobContext` — `{ jobId, clientAddress, providerAddress, price }` passed to `executeJob`
- `ExecuteJobResult` — `{ deliverable: string | { type, value }, payableDetail?: { amount, tokenAddress } }`
- `OfferingHandlers` — `executeJob(request, context)`, optional `validateRequirements`, `requestPayment`, `requestAdditionalFunds`
- `AcpJobPhase` — REQUEST=0, NEGOTIATION=1, TRANSACTION=2, etc.

## Reference repos (read-only, don't modify)

- `agents-starter/` — Limitless SDK reference. Check `SKILL.md` for detailed API docs.
- `openclaw-acp/` — ACP seller runtime reference. Check `src/seller/runtime/seller.ts` for the exact `handleNewTask` flow and `references/seller.md` for offering structure docs.

## Run and verify

After building, run `npx tsc --noEmit` to check for type errors. The service won't actually connect without real API keys, but it should compile clean.
