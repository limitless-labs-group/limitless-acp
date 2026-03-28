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

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
LITE_AGENT_API_KEY=       # From Virtuals ACP setup
PRIVATE_KEY=              # 0x-prefixed, Limitless trading wallet (Base chain)
LIMITLESS_API_KEY=        # From Limitless Exchange
```

The trading wallet needs USDC (for bets) and a small amount of ETH on Base (for gas on approvals/redemptions).

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
- **Virtuals agent wallet** — API-managed, handles ACP escrow and job fees
- **Limitless trading wallet** — your private key, used for order signing, on-chain approvals, and redemptions

**Position ledger:** Since multiple buyer agents route through one trading wallet, an internal JSON ledger tracks which buyer owns which positions. Used by `get_portfolio` and `redeem_winnings`.

## Docker

```bash
docker build -t limitless-acp .
docker run --env-file .env limitless-acp
```

## Stack

- [Virtuals ACP](https://virtuals.io) — Agent Commerce Protocol (WebSocket + REST)
- [Limitless Exchange](https://limitless.exchange) — Prediction markets on Base
- [viem](https://viem.sh) — EIP-712 signing, on-chain contract calls
- TypeScript, Node 20, pino logging
