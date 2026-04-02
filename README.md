# Limitless ACP

Persistent ACP (Agent Commerce Protocol) seller service that exposes [Limitless Exchange](https://limitless.exchange) prediction market capabilities on the [Virtuals Protocol](https://virtuals.io) marketplace.

Buyer agents can discover markets, place bets, track portfolios, and redeem winnings — all through ACP job offerings.

## Offerings

| Name | Fee | Description |
|------|-----|-------------|
| `browse_markets` | $0.01 fixed | Search and list active prediction markets |
| `place_bet` | 2% of funds | Place YES/NO bets on CLOB markets |
| `get_portfolio` | $0.01 fixed | View positions and unrealized P&L |
| `redeem_winnings` | $0.05 fixed | Claim resolved market winnings, returns USDC |

## Prerequisites

1. **Register your agent** at [app.virtuals.io/acp/join](https://app.virtuals.io/acp/join)
   - Connect wallet, create agent profile as **Provider**
   - Add the four job offerings above (enable "Require Funds" for `place_bet`)
   - Create smart wallet and whitelist your dev wallet
   - Note your **Agent Wallet Address**, **Entity ID**, and **Whitelisted Wallet Private Key**

2. **Limitless Exchange** API key from [limitless.exchange](https://limitless.exchange)

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
LIMITLESS_API_KEY=               # From Limitless Exchange
```

## Usage

Start the seller daemon:

```bash
npm start
```

Pre-approve a market venue (optional, happens lazily on first trade):

```bash
npm run approve <market-slug>
```

## Architecture

**Two-wallet setup:**
- **Virtuals agent wallet** — SDK-managed smart wallet, handles ACP escrow and job fees (gas sponsored)
- **Limitless trading wallet** — your private key, used for order signing, on-chain approvals, and redemptions (needs ETH for gas)

**Position ledger:** Since multiple buyer agents route through one trading wallet, an internal JSON ledger tracks which buyer owns which positions. Used by `get_portfolio` and `redeem_winnings`.

**ACP SDK integration:** Uses the official [`@virtuals-protocol/acp-node`](https://www.npmjs.com/package/@virtuals-protocol/acp-node) SDK with `AcpClient` + `AcpContractClientV2` for the full job lifecycle (REQUEST → NEGOTIATION → TRANSACTION → EVALUATION).

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

- [@virtuals-protocol/acp-node](https://www.npmjs.com/package/@virtuals-protocol/acp-node) — Official ACP SDK (WebSocket + smart contracts)
- [Limitless Exchange](https://limitless.exchange) — Prediction markets on Base
- [viem](https://viem.sh) — EIP-712 signing, on-chain contract calls
- TypeScript, Node 20, pino logging
