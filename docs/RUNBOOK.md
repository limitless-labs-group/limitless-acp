# Limitless ACP Seller — Server Runbook

**Status:** Live and transacting
**Repo:** `github.com/limitless-labs-group/limitless-acp`

## What it is

A Node/TypeScript daemon that sells Limitless prediction-market services on the
Virtuals ACP agent marketplace. Other AI agents pay USDC on Base per job. Four
offerings: `browse_markets` ($0.01), `place_bet` ($0.01 + stake),
`get_portfolio` ($0.01), `redeem_winnings` ($0.05). Jobs complete in ~25s.

## How it works

- Connects **outbound** to Virtuals ACP (`api.acp.virtuals.io`) over an event
  stream; receives jobs, sets budgets, submits deliverables. Gas for
  agent-wallet operations is sponsored by Virtuals.
- Executes against the **Limitless API** (`api.limitless.exchange`) using
  HMAC-signed scoped tokens, and against **Base chain** (viem) for venue
  approvals and CTF redemptions.
- **Two-wallet model:** the Virtuals agent smart wallet (receives job fees) and
  a separate hot trading EOA (signs orders, holds trading USDC + gas ETH).
  Buyer stakes for bets route to the trading EOA via ACP fund requests.
- **`ledger.json`** maps positions to the buyer agents that own them (many
  buyers share one trading wallet). This file is state and must persist.

## Box requirements

- Small Linux VM, 2 vCPU / 2–4 GB, Node 20+
- Outbound HTTPS only; **no inbound ports**
- **Single instance only** — two copies would race on the same jobs

## Setup

```bash
git clone https://github.com/limitless-labs-group/limitless-acp.git
cd limitless-acp && npm ci
# provision .env by hand (secret store; never committed)
# copy ledger.json from the previous host
pm2 start npm --name limitless-seller -- start
```

## Secrets (`.env` — names only, values from secret store)

| Key | Purpose |
|---|---|
| `SELLER_AGENT_WALLET_ADDRESS`, `ACP_WALLET_ID`, `ACP_SIGNER_PRIVATE_KEY` | Virtuals ACP v2 agent identity + signer |
| `PRIVATE_KEY` | Limitless trading EOA (hot wallet) |
| `LIMITLESS_HMAC_TOKEN_ID`, `LIMITLESS_HMAC_SECRET` | Limitless API auth (scoped token) |
| `LIMITLESS_API_URL`, `LOG_LEVEL`, `DRY_RUN` | Config |
| `REQUESTOR_*`, `SMOKE_*`, `TARGET_PROVIDER_AGENT_WALLET_ADDRESS` | Test buyer agent (smoke tests only) |

## Wallets

| Wallet | Address | Holds |
|---|---|---|
| Seller agent (Virtuals) | `0x960c2b2638d5c5a19abb5cab271886febdaf5d55` | Earned fees |
| Trading EOA (Limitless) | `0x015f5f8D4fA144e121be4C5529DC57a0DC9C99B3` | Trading USDC + gas ETH |
| Test requestor (Virtuals) | `0xe74ec2cdbbb178178da48ab6238f0ea5f5798c1d` | USDC for smoke jobs |

## Operations

- Logs: pino to stdout (`pm2 logs limitless-seller`); restart-on-crash via pm2
- Boot runs a **preflight** that warns if Limitless auth or trading mode is
  broken — check logs after every start
- ⚠️ Re-deriving the API token in the Limitless web UI **revokes the running
  one**; if someone does, update `.env` and restart
- ⚠️ Logging into limitless.exchange can flip the account to smart-wallet mode,
  which breaks order placement; preflight catches it (fix: `PUT /profiles`
  with `{"tradeWalletOption": "eoa"}`)
- Smoke tests: `npm run smoke:seller` (handlers only), `npm run smoke:buyer`
  (full ACP round-trip, costs ~$0.01)

## Known issues (Virtuals-side, escalated)

1. Fund-request escrow releases not settling to destination (intent 521,
   0.5 USDC) — bet stakes are fronted by the trading EOA until fixed
2. Agent not yet surfacing in ACP search — buyers must use the wallet address
   directly

## Cutover checklist

- [ ] `.env` + `ledger.json` copied to box
- [ ] Old instance stopped **before** starting the new one
- [ ] Boot log shows preflight clean + "Seller runtime is running (ACP v2)"
- [ ] One `smoke:buyer` browse_markets round-trip completes
