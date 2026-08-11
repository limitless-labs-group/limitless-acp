# Limitless ACP

Persistent ACP (Agent Commerce Protocol) seller service that exposes [Limitless Exchange](https://limitless.exchange) prediction market capabilities on the [Virtuals Protocol](https://virtuals.io) marketplace.

Buyer agents can discover markets, place bets, track portfolios, and redeem winnings — all through ACP job offerings.

## Offerings

| Name              | Fee         | Description                                  |
| ----------------- | ----------- | -------------------------------------------- |
| `browse_markets`  | $0.01 fixed | Search and list active prediction markets    |
| `place_bet`       | 2% of funds | Place YES/NO bets on CLOB markets            |
| `get_portfolio`   | $0.01 fixed | View positions and unrealized P&L            |
| `redeem_winnings` | $0.05 fixed | Claim resolved market winnings, returns USDC |

## Prerequisites

1. **Register your agent** at [app.virtuals.io/acp/join](https://app.virtuals.io/acp/join)
   - Connect wallet, create agent profile as **Provider**
   - Add the four job offerings above (enable "Require Funds" for `place_bet`)
   - Create smart wallet and whitelist your dev wallet
   - Note your **Agent Wallet Address**, **Entity ID**, and **Whitelisted Wallet Private Key**

2. **Limitless HMAC API token** tied to the trading wallet (see [Limitless API authentication](#limitless-api-authentication))

3. **Base chain wallet** with USDC (for bets) and a small amount of ETH (for gas on approvals/redemptions)

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
# ACP (from Virtuals registration)
WHITELISTED_WALLET_PRIVATE_KEY=  # 0x-prefixed, whitelisted dev wallet
SELLER_AGENT_WALLET_ADDRESS=     # Smart wallet from ACP registration
SELLER_ENTITY_ID=                # Entity ID from ACP registration

# Limitless
PRIVATE_KEY=                     # 0x-prefixed, trading wallet (Base chain)
LIMITLESS_HMAC_TOKEN_ID=         # Scoped API token (npm run derive-token)
LIMITLESS_HMAC_SECRET=           # Shown once at derivation
```

## Limitless API authentication

Limitless deprecated static API keys; authenticated endpoints (orders,
portfolio) now require a **scoped API token with HMAC-SHA256 request
signing**, handled by the official
[`@limitless-exchange/sdk`](https://www.npmjs.com/package/@limitless-exchange/sdk).

The token is tied to a Limitless account, and it must be the account of the
**trading wallet** (the EOA behind `PRIVATE_KEY`) — not the Virtuals ACP
agent wallet — because orders are EIP-712 signed by that EOA.

To derive credentials:

1. Log in to [limitless.exchange](https://limitless.exchange) in a browser
   **using the trading wallet**.
2. Copy the `privy-id-token` cookie value from devtools (it is short-lived,
   so use it promptly).
3. Run:

```bash
npm run derive-token -- <privy-identity-token>
```

The script prints `LIMITLESS_HMAC_TOKEN_ID` / `LIMITLESS_HMAC_SECRET` lines
for your `.env` (the secret is shown only once) plus the token's profile
account so you can confirm it matches the trading wallet. Market browsing is
public and works without credentials.

## Usage

Start the seller daemon:

```bash
npm start
```

Run a local buyer smoke test against a provider agent (requestor env vars required):

```bash
npm run smoke:buyer
```

Compact screenshot-friendly output:

```bash
SMOKE_COMPACT=true npm run smoke:buyer
```

Provider-only smoke test (bypasses ACP buyer negotiation/userOp path):

```bash
SELLER_SMOKE_OFFERING=browse_markets npm run smoke:seller
```

This is useful when ACP paymaster/userOp is flaky and you want to validate
offering handler logic independently.

Notes for offering-specific smoke tests:

- `SMOKE_OFFERING_NAME=get_portfolio` (optional `SMOKE_INCLUDE_HISTORY=true`)
- `SMOKE_OFFERING_NAME=redeem_winnings` (optional `SMOKE_MARKET_SLUG=<slug>`)
- `SMOKE_OFFERING_NAME=place_bet` requires `SMOKE_MARKET_SLUG` and optionally `SMOKE_AMOUNT`, `SMOKE_SIDE`, `SMOKE_ORDER_TYPE`.

Pre-approve a market venue (optional, happens lazily on first trade):

```bash
npm run approve <market-slug>
```

## MCP server (market data)

An [MCP](https://modelcontextprotocol.io) server exposing public Limitless
market data to any MCP client (Claude, ChatGPT, Cursor, agent frameworks).
Read-only, no credentials required. Tools: `search_markets`,
`get_active_markets`, `get_market`, `get_orderbook`.

```bash
npm run mcp        # stdio (local clients, e.g. `claude mcp add limitless -- npx tsx src/mcp/stdio.ts`)
npm run mcp:http   # streamable HTTP on :3333 at /mcp (remote hosting; MCP_PORT to override)
npm run smoke:mcp  # spawns the stdio server and exercises every tool
```

## Architecture

**Two-wallet setup:**

- **Virtuals agent wallet** — SDK-managed smart wallet, handles ACP escrow and job fees (gas sponsored)
- **Limitless trading wallet** — your private key, used for order signing, on-chain approvals, and redemptions (needs ETH for gas)

**Position ledger:** Since multiple buyer agents route through one trading wallet, an internal JSON ledger tracks which buyer owns which positions. Used by `get_portfolio` and `redeem_winnings`.

**ACP SDK integration:** Uses the official [`@virtuals-protocol/acp-node-v2`](https://www.npmjs.com/package/@virtuals-protocol/acp-node-v2) SDK — `AcpAgent` + `JobSession` with event-driven job handling (`job.created` → requirement/budget → `job.funded` → execute → `submit`). Requires upgrading the agent in the Virtuals UI to obtain `walletId` + `signerPrivateKey` (set `ACP_WALLET_ID` / `ACP_SIGNER_PRIVATE_KEY`). Buyer funds for `place_bet` route to the Limitless trading wallet via the v2 fund-request mechanism (`setBudgetWithFundRequest`).

## Graduation

After registering, the agent starts in **sandbox** mode. To graduate:

1. Complete 10 successful sandbox transactions (including 3 consecutive)
2. Submit graduation request from agent profile or via the modal
3. Virtuals team reviews within 7 working days

See [graduation docs](https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/graduate-agent) for details.

## Docker

```bash
docker build -t limitless-acp .
docker run --env-file .env limitless-acp
```

## Stack

- [@virtuals-protocol/acp-node-v2](https://www.npmjs.com/package/@virtuals-protocol/acp-node-v2) — Official ACP SDK v2 (event-driven, AcpAgent/JobSession)
- [@limitless-exchange/sdk](https://www.npmjs.com/package/@limitless-exchange/sdk) — Official Limitless SDK (HMAC auth, EIP-712 order signing, portfolio)
- [Limitless Exchange](https://limitless.exchange) — Prediction markets on Base
- [viem](https://viem.sh) — On-chain contract calls (approvals, CTF redemption)
- TypeScript, Node 20, pino logging
