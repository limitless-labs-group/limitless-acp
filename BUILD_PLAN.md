# Limitless ACP Integration - Build Plan

Build a persistent ACP seller service that exposes Limitless prediction market capabilities as offerings on the Virtuals Agent Commerce Protocol marketplace.

## Reference Repos (in this workspace, for reference only)

- `agents-starter/` - Limitless Exchange SDK and trading agents. Contains the full client surface for markets, trading, signing, redeem, portfolio, approvals, websocket. All on Base chain.
- `openclaw-acp/` - Virtuals ACP CLI and seller runtime. Contains the seller runtime pattern (WebSocket daemon), offering structure, API client, config management. This is the pattern we follow for building our seller service.

Do NOT modify or ship either reference repo. Build a new standalone project at the workspace root.

---

## Architecture

### Two-wallet setup

1. **Virtuals agent wallet** - API-managed by Virtuals (no raw private key access). Handles ACP payment flows (escrow, job fees, `requestAdditionalFunds` transfers). Identified by `LITE_AGENT_API_KEY`.
2. **Limitless trading wallet** - Our own private key (`PRIVATE_KEY` env var). Used for EIP-712 order signing, on-chain CTF contract calls (redeem), and USDC/CTF approvals. This is where prediction market positions live.

When a buyer sends funds via ACP `requestAdditionalFunds`, we set the `recipient` to the Limitless trading wallet address so funds route there directly for trade execution.

### Seller runtime pattern

Follow the pattern from `openclaw-acp/src/seller/runtime/`:
- `seller.ts` is the main entrypoint - a persistent daemon
- Connects to ACP WebSocket at `acpx.virtuals.io` via `connectAcpSocket()`
- Listens for `onNewTask` events, routes to offering handlers based on offering name
- Handles the job lifecycle: REQUEST (accept/reject + validate) -> NEGOTIATION (payment request) -> TRANSACTION (execute + deliver)
- Offerings are loaded dynamically from `src/offerings/<name>/` directories, each with `offering.json` (config) and `handlers.ts` (logic)

### Position ledger

Since multiple buyer agents route bets through a single trading wallet, maintain an internal ledger (JSON file) tracking:
- Which buyer (by `clientAddress`) owns which positions
- Market slug, side (YES/NO), amount, order details
- Status (open, filled, redeemed)

This is needed for `get_portfolio` (filter positions by buyer) and `redeem_winnings` (return correct amounts to correct buyers).

---

## Project Setup

### Directory structure

```
limitless-acp/
├── src/
│   ├── seller.ts                    # Main entrypoint (persistent daemon)
│   ├── acpSocket.ts                 # ACP WebSocket client (from openclaw-acp pattern)
│   ├── acpApi.ts                    # ACP seller API calls (accept, payment, deliver)
│   ├── acpClient.ts                 # Axios HTTP client for ACP API
│   ├── acpConfig.ts                 # Config management (config.json, API key, PID)
│   ├── acpTypes.ts                  # ACP types (job phases, memos, socket events)
│   ├── limitless/
│   │   ├── markets.ts               # LimitlessClient (from agents-starter)
│   │   ├── trading.ts               # TradingClient (from agents-starter)
│   │   ├── sign.ts                  # OrderSigner (from agents-starter)
│   │   ├── redeem.ts                # RedeemClient (from agents-starter)
│   │   ├── portfolio.ts             # PortfolioClient (from agents-starter)
│   │   ├── approve.ts               # USDC/CTF approvals (from agents-starter)
│   │   ├── websocket.ts             # LimitlessWebSocket (from agents-starter)
│   │   ├── wallet.ts                # getWallet() helper (from agents-starter)
│   │   └── types.ts                 # Limitless types (from agents-starter)
│   ├── offerings/
│   │   ├── loader.ts                # Dynamic offering loader
│   │   ├── browse_markets/
│   │   │   ├── offering.json
│   │   │   └── handlers.ts
│   │   ├── place_bet/
│   │   │   ├── offering.json
│   │   │   └── handlers.ts
│   │   ├── get_portfolio/
│   │   │   ├── offering.json
│   │   │   └── handlers.ts
│   │   └── redeem_winnings/
│   │       ├── offering.json
│   │       └── handlers.ts
│   └── ledger.ts                    # Position tracking ledger
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── Dockerfile
└── config.json                      # Git-ignored, created by acp setup
```

### package.json

- Name: `limitless-acp`
- Type: `"module"` (ESM)
- Dependencies: `axios`, `cross-fetch`, `dotenv`, `pino`, `pino-pretty`, `socket.io-client`, `viem`
- Dev dependencies: `typescript`, `tsx`, `prettier`
- Scripts:
  - `start` - `tsx src/seller.ts` (starts the persistent seller service)
  - `approve` - `tsx src/scripts/approve.ts` (run USDC/CTF approvals for a market)

### tsconfig.json

- Target: ES2022
- Module: NodeNext / Node16
- outDir: dist, rootDir: src

### .env.example

```
# ACP (Virtuals)
LITE_AGENT_API_KEY=           # From `acp setup`
ACP_SOCKET_URL=https://acpx.virtuals.io
ACP_API_URL=https://claw-api.virtuals.io
ACP_BUILDER_CODE=             # Optional builder attribution code

# Limitless
PRIVATE_KEY=                  # 0x-prefixed 32-byte hex, for order signing & on-chain ops
LIMITLESS_API_KEY=            # Limitless Exchange API key
LIMITLESS_API_URL=https://api.limitless.exchange

# Operational
LOG_LEVEL=info
DRY_RUN=false                # Set true to skip actual order submission
```

### .gitignore

```
node_modules/
dist/
config.json
.env
ledger.json
logs/
```

---

## ACP Infrastructure (adapt from openclaw-acp)

These files adapt the seller runtime from `openclaw-acp/src/seller/runtime/` and `openclaw-acp/src/lib/`. Simplify for our single-purpose service (we don't need the full CLI, multi-agent switching, etc).

### `src/acpTypes.ts`

Copy from `openclaw-acp/src/seller/runtime/types.ts`. Contains:
- `AcpJobPhase` enum (REQUEST=0, NEGOTIATION=1, TRANSACTION=2, EVALUATION=3, COMPLETED=4, REJECTED=5, EXPIRED=6)
- `MemoType` enum
- `AcpMemoData` interface
- `AcpJobEventData` interface
- `SocketEvent` enum

### `src/acpSocket.ts`

Copy from `openclaw-acp/src/seller/runtime/acpSocket.ts`. WebSocket client that:
- Connects to `acpx.virtuals.io` with `{ walletAddress }` auth
- Listens for `onNewTask` and `onEvaluate` events
- Returns a cleanup/disconnect function

### `src/acpApi.ts`

Copy from `openclaw-acp/src/seller/runtime/sellerApi.ts`. Three API calls:
- `acceptOrRejectJob(jobId, { accept, reason })` - POST `/acp/providers/jobs/{id}/accept`
- `requestPayment(jobId, { content, payableDetail? })` - POST `/acp/providers/jobs/{id}/requirement`
- `deliverJob(jobId, { deliverable, payableDetail? })` - POST `/acp/providers/jobs/{id}/deliverable`

### `src/acpClient.ts`

Copy from `openclaw-acp/src/lib/client.ts`. Axios instance with:
- baseURL: `ACP_API_URL` env var (default `https://claw-api.virtuals.io`)
- Headers: `x-api-key` from `LITE_AGENT_API_KEY`, `x-builder-code` from `ACP_BUILDER_CODE`

### `src/acpConfig.ts`

Simplified from `openclaw-acp/src/lib/config.ts`. We need:
- `readConfig()` / `writeConfig()` for `config.json`
- `loadApiKey()` - load `LITE_AGENT_API_KEY` from config or env
- `writePidToConfig()` / `removePidFromConfig()` - PID management
- `checkForExistingProcess()` - prevent duplicate seller processes

We also need `getMyAgentInfo()` adapted from `openclaw-acp/src/lib/wallet.ts` which calls GET `/acp/me` to get the agent's wallet address and name.

---

## Limitless SDK (adapt from agents-starter)

Copy these files from `agents-starter/src/core/limitless/` into `src/limitless/`:

- `types.ts` - Market, Orderbook, SignedOrder, EIP712 types. Copy as-is.
- `markets.ts` - LimitlessClient. Copy as-is. Key methods: `getActiveMarkets()`, `searchMarkets()`, `getMarket()`, `getOrderbook()`.
- `trading.ts` - TradingClient. Copy as-is. Key method: `createOrder({ marketSlug, side, limitPriceCents, usdAmount, orderType })`.
- `sign.ts` - OrderSigner. Copy as-is. EIP-712 signing for CLOB orders.
- `redeem.ts` - RedeemClient. Copy as-is. On-chain CTF redemption.
- `portfolio.ts` - PortfolioClient. Copy as-is. Key methods: `getPositions()`, `getTrades()`, `verifyFill()`.
- `approve.ts` - `approveMarketVenue()`. Copy and adapt (it imports `getWallet` from `../wallet.ts`, update the import path).
- `websocket.ts` - LimitlessWebSocket. Copy as-is. Not critical for MVP but useful for future real-time features.
- `wallet.ts` - `getWallet()`. Copy from `agents-starter/src/core/wallet.ts`. Creates a viem WalletClient from `PRIVATE_KEY`.

---

## Position Ledger

### `src/ledger.ts`

Simple JSON file-backed ledger at `ledger.json` in the project root.

```typescript
interface LedgerEntry {
  id: string;                    // UUID
  buyerAddress: string;          // ACP client wallet address
  acpJobId: number;              // ACP job ID
  marketSlug: string;
  side: "YES" | "NO";
  amountUsd: number;             // USD amount bet
  limitPriceCents: number;       // Price paid per contract
  orderType: "GTC" | "FOK";
  status: "pending" | "filled" | "redeemed" | "failed";
  orderId?: string;              // Limitless order ID
  createdAt: string;             // ISO timestamp
  redeemedAt?: string;
  redeemTxHash?: string;
  payoutUsd?: number;            // Amount returned on redeem
}

interface Ledger {
  positions: LedgerEntry[];
}
```

Functions:
- `readLedger(): Ledger`
- `writeLedger(ledger: Ledger): void`
- `addPosition(entry: Omit<LedgerEntry, "id" | "createdAt">): LedgerEntry`
- `updatePosition(id: string, updates: Partial<LedgerEntry>): void`
- `getPositionsByBuyer(buyerAddress: string): LedgerEntry[]`
- `getRedeemablePositions(buyerAddress?: string): LedgerEntry[]`

---

## Offering 1: `browse_markets`

### `src/offerings/browse_markets/offering.json`

```json
{
  "name": "browse_markets",
  "description": "Search and browse active prediction markets on Limitless Exchange. Returns market titles, current odds, volume, liquidity, and expiry times. Supports filtering by query string, category, and trade type.",
  "jobFee": 0.01,
  "jobFeeType": "fixed",
  "requiredFunds": false,
  "requirement": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query to filter markets (e.g. 'BTC', 'election', 'ETH above')"
      },
      "tradeType": {
        "type": "string",
        "enum": ["amm", "clob", "group"],
        "description": "Filter by trade type"
      },
      "limit": {
        "type": "number",
        "description": "Max number of markets to return (default 20, max 50)"
      }
    }
  }
}
```

### `src/offerings/browse_markets/handlers.ts`

- `validateRequirements`: If `limit` is provided, cap at 50.
- `executeJob`:
  1. If `query` is provided, call `LimitlessClient.searchMarkets(query, { limit })`
  2. Otherwise, call `LimitlessClient.getActiveMarkets({ tradeType, limit })`
  3. Map results to a clean summary: `{ markets: [{ slug, title, prices, volume, liquidity, expirationTimestamp, tradeType }] }`
  4. Return `{ deliverable: JSON.stringify(result) }`

---

## Offering 2: `place_bet`

### `src/offerings/place_bet/offering.json`

```json
{
  "name": "place_bet",
  "description": "Place a bet on a prediction market outcome on Limitless Exchange. Supports YES/NO outcomes on CLOB markets. Funds are transferred and the order is executed on your behalf.",
  "jobFee": 0.02,
  "jobFeeType": "percentage",
  "requiredFunds": true,
  "requirement": {
    "type": "object",
    "properties": {
      "marketSlug": {
        "type": "string",
        "description": "Market slug identifier (from browse_markets)"
      },
      "side": {
        "type": "string",
        "enum": ["YES", "NO"],
        "description": "Outcome to bet on"
      },
      "amount": {
        "type": "number",
        "description": "Amount in USD to bet"
      },
      "limitPriceCents": {
        "type": "number",
        "description": "Max price per contract in cents (1-99). If omitted, uses current market price as ceiling."
      },
      "orderType": {
        "type": "string",
        "enum": ["GTC", "FOK"],
        "description": "Order type. FOK (fill-or-kill) is default and recommended."
      }
    },
    "required": ["marketSlug", "side", "amount"]
  }
}
```

### `src/offerings/place_bet/handlers.ts`

- `validateRequirements`:
  - `marketSlug` must be non-empty string
  - `side` must be "YES" or "NO"
  - `amount` must be > 0
  - `limitPriceCents` if provided must be 1-99
  - Optionally: call `LimitlessClient.getMarket(slug)` to verify market exists and is active. If it fails or market is not FUNDED, reject with reason.

- `requestAdditionalFunds`:
  - Returns `{ amount: request.amount, tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" (USDC on Base), recipient: <trading wallet address from getWallet()> }`
  - The `content` field: `"Transfer ${amount} USDC for prediction market bet on ${marketSlug}"`

- `executeJob`:
  1. Initialize `LimitlessClient`, `OrderSigner`, `TradingClient` using the trading wallet
  2. Determine `limitPriceCents`: use provided value, or fetch current market price via `getMarket()` and use `prices[sideIndex]` as ceiling
  3. Ensure market venue is approved (call `approveMarketVenue` if needed, or pre-approve on startup)
  4. Call `TradingClient.createOrder({ marketSlug, side, limitPriceCents, usdAmount: request.amount, orderType: request.orderType || "FOK" })`
  5. Record the position in the ledger: `addPosition({ buyerAddress: <from ACP job clientAddress>, acpJobId, marketSlug, side, amountUsd, limitPriceCents, orderType, status: "filled", orderId })`
  6. Return `{ deliverable: JSON.stringify({ status: "filled", marketSlug, side, amountUsd, orderId, ... }) }`
  7. On error, return `{ deliverable: JSON.stringify({ status: "failed", error: message }) }`

**Important:** The `executeJob` handler receives only the `request` (buyer's requirements). To access `clientAddress` and `acpJobId`, we need to pass these through. Options:
- Modify the offering loader to inject job metadata into the handler call. The seller runtime in `openclaw-acp` calls `handlers.executeJob(requirements)` where `requirements` comes from parsing the negotiation memo. We should extend this to pass the full job context: `handlers.executeJob(requirements, { jobId, clientAddress })`.
- Update the `OfferingHandlers` interface to accept an optional second argument with job metadata.

### Approval handling

Before the service can trade on a market, it needs USDC and CTF approvals for that market's venue (exchange contract). Two approaches:
1. **Lazy approval**: Check and approve on first trade for each market venue. Adds latency to the first trade per venue but is simpler.
2. **Eager approval**: On startup, fetch all active markets and pre-approve their venues. Faster trades but expensive in gas if there are many venues.

Recommend lazy approval for MVP. Cache which venues are already approved in memory to avoid repeated on-chain checks.

---

## Offering 3: `get_portfolio`

### `src/offerings/get_portfolio/offering.json`

```json
{
  "name": "get_portfolio",
  "description": "View your current prediction market positions, open orders, and P&L from bets placed through this service.",
  "jobFee": 0.01,
  "jobFeeType": "fixed",
  "requiredFunds": false,
  "requirement": {
    "type": "object",
    "properties": {
      "includeHistory": {
        "type": "boolean",
        "description": "Include trade history (default false)"
      }
    }
  }
}
```

### `src/offerings/get_portfolio/handlers.ts`

- `executeJob`:
  1. Get `clientAddress` from job metadata (see note in place_bet about passing job context)
  2. Read ledger entries for this buyer: `getPositionsByBuyer(clientAddress)`
  3. For each position with status "filled", optionally enrich with current market data (current prices, P&L) by calling `LimitlessClient.getMarket(slug)` or `PortfolioClient.getPositions()`
  4. If `includeHistory`, also include past trades from the ledger
  5. Return `{ deliverable: JSON.stringify({ positions, summary: { totalInvested, currentValue, unrealizedPnl } }) }`

Note: We rely on the ledger for per-buyer tracking, not the Limitless portfolio API directly (which shows the aggregate wallet). The Limitless portfolio data can enrich with current market prices.

---

## Offering 4: `redeem_winnings`

### `src/offerings/redeem_winnings/offering.json`

```json
{
  "name": "redeem_winnings",
  "description": "Claim winnings from resolved prediction markets. Returns USDC proceeds to your agent wallet.",
  "jobFee": 0.05,
  "jobFeeType": "fixed",
  "requiredFunds": false,
  "requirement": {
    "type": "object",
    "properties": {
      "marketSlug": {
        "type": "string",
        "description": "Specific market to redeem from. If omitted, redeems all resolved winning positions."
      }
    }
  }
}
```

### `src/offerings/redeem_winnings/handlers.ts`

- `validateRequirements`: Optional validation that the buyer has redeemable positions in the ledger.

- `executeJob`:
  1. Get `clientAddress` from job metadata
  2. Get redeemable positions from ledger: `getRedeemablePositions(clientAddress)`. Filter to specific `marketSlug` if provided.
  3. For each redeemable position:
     a. Call `RedeemClient.redeemSingle(marketSlug)` to claim on-chain
     b. Calculate the USDC proceeds
     c. Update ledger entry: `updatePosition(id, { status: "redeemed", redeemedAt, redeemTxHash, payoutUsd })`
  4. Sum total payout across all redeemed positions
  5. Return `{ deliverable: JSON.stringify({ redeemed: [...details], totalPayout }), payableDetail: { tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: totalPayout } }`
  6. The `payableDetail` tells ACP to transfer the USDC winnings back to the buyer agent wallet

---

## Main Entrypoint

### `src/seller.ts`

Adapt from `openclaw-acp/src/seller/runtime/seller.ts`:

1. **Startup**:
   - Load env vars (`dotenv`)
   - Load ACP API key from `config.json` or env
   - Call ACP API GET `/acp/me` to get agent wallet address and name
   - Initialize Limitless clients (LimitlessClient, TradingClient, OrderSigner, RedeemClient, PortfolioClient) using `PRIVATE_KEY`
   - Load offerings from `src/offerings/`
   - Check for existing seller process (PID management)
   - Write PID to config
   - Set up SIGINT/SIGTERM cleanup handlers

2. **Connect to ACP**:
   - Call `connectAcpSocket({ acpUrl, walletAddress, callbacks: { onNewTask: handleNewTask } })`
   - Log "Seller runtime is running. Waiting for jobs..."

3. **handleNewTask(data: AcpJobEventData)**:
   - Same flow as `openclaw-acp/src/seller/runtime/seller.ts`:
   - REQUEST phase: resolve offering name from memo, validate requirements, accept/reject, request payment
   - TRANSACTION phase: resolve offering name, execute handler, deliver result
   - Pass job metadata (jobId, clientAddress) to handlers alongside requirements

---

## Seller runtime modification

The `openclaw-acp` seller runtime calls `handlers.executeJob(requirements)` with only the parsed requirements object. We need job metadata (especially `clientAddress` and job `id`) in our handlers for ledger tracking.

Modify the handler interface and seller runtime to pass a context object:

```typescript
interface JobContext {
  jobId: number;
  clientAddress: string;
  providerAddress: string;
  price: number;
}

interface OfferingHandlers {
  executeJob: (request: Record<string, any>, context: JobContext) => Promise<ExecuteJobResult>;
  validateRequirements?: (request: Record<string, any>) => ValidationResult | Promise<ValidationResult>;
  requestPayment?: (request: Record<string, any>) => string | Promise<string>;
  requestAdditionalFunds?: (request: Record<string, any>) => { content?: string; amount: number; tokenAddress: string; recipient: string } | Promise<{ content?: string; amount: number; tokenAddress: string; recipient: string }>;
}
```

In `seller.ts` handleNewTask, when calling executeJob during TRANSACTION phase:

```typescript
const context: JobContext = {
  jobId: data.id,
  clientAddress: data.clientAddress,
  providerAddress: data.providerAddress,
  price: data.price,
};
const result = await handlers.executeJob(requirements, context);
```

---

## Build Order

1. Project setup: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`
2. Copy and adapt ACP infrastructure: `acpTypes.ts`, `acpSocket.ts`, `acpApi.ts`, `acpClient.ts`, `acpConfig.ts`
3. Copy Limitless SDK files into `src/limitless/`
4. Build the offering loader (`src/offerings/loader.ts`)
5. Build the ledger (`src/ledger.ts`)
6. Build the main seller entrypoint (`src/seller.ts`)
7. Implement `browse_markets` offering (simplest, no funds flow)
8. Implement `place_bet` offering (funds in, most complex)
9. Implement `get_portfolio` offering (reads ledger)
10. Implement `redeem_winnings` offering (funds out, on-chain)
11. Add Dockerfile
12. Test locally with `DRY_RUN=true`

---

## Contract Addresses (Base Mainnet)

- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- CTF (Conditional Tokens Framework): `0xC9c98965297Bc527861c898329Ee280632B76e18`
- Exchange: `0x05c748E2f4DcDe0ec9Fa8DDc40DE6b867f923fa5`
- Limitless API: `https://api.limitless.exchange`
- Limitless WebSocket: `wss://ws.limitless.exchange`
- ACP API: `https://claw-api.virtuals.io`
- ACP Socket: `https://acpx.virtuals.io`

---

## Notes

- All Limitless SDK code uses `cross-fetch` for HTTP, `viem` for on-chain, `pino` for logging
- ACP client uses `axios`
- Order signing uses EIP-712 typed data with market-specific `verifyingContract` (the venue exchange address)
- FOK orders have specific API quirks: `takerAmount` must be exactly `1n`, `makerAmount` is USD spend in micro-units, no `price` field in body
- GTC orders are tick-aligned to nearest 1000 contracts
- Rate limiting is built into TradingClient: 300ms minimum gap between submissions, max 2 concurrent
- The RedeemClient does on-chain transactions and requires ETH on Base for gas
