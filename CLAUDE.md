# Claude context — Limitless ACP

Use this file for quick orientation; full setup and APIs live in **[README.md](./README.md)** and **[.env.example](./.env.example)**.

## What this repo is

- **ACP seller daemon** exposing Limitless prediction markets on Virtuals ACP (`browse_markets`, `place_bet`, `get_portfolio`, `redeem_winnings`).
- **Stack:** TypeScript (ESM), Node 20+, `tsx`, `@virtuals-protocol/acp-node`, `viem`, Limitless REST API.

## Important architecture

- **Two wallets:** Virtuals agent smart wallet (ACP / SDK) + separate **Limitless trading** EOA (`PRIVATE_KEY`) for orders, approvals, redemption gas.
- **Position ledger:** Internal JSON splits ownership across buyers sharing one trading wallet — relevant for portfolio and redemption logic.

## Commands (local or server)

```bash
npm install
npm start                    # seller: src/seller.ts
npm run smoke:seller        # invokes offering handlers without full ACP buyer path
npm run smoke:buyer         # end-to-end against TARGET_PROVIDER_AGENT_WALLET_ADDRESS
npm run approve -- <slug>    # optional venue approval
```

Prefer **`smoke:seller`** when validating Limitless/integration only; **`smoke:buyer`** when debugging ACP negotiation, paymaster, or user operations.

---

## Dedicated server (persistent runs)

Treat the **GCP VM / dedicated box** as the place for **long-lived `npm start`**, smoke tests against production-like networking, and anything that must stay reachable.

**Suggested workflow:**

1. SSH to the VM (team standard; often IAP — see GCP note below).
2. Clone or `git pull` this repo; `npm ci` for reproducible installs.
3. Install **server-only** `.env` (never commit). Copy from a password manager or team secret store; match `.env.example` keys.
4. Run the seller under **tmux**, **systemd**, or **pm2** so it survives disconnects; set `LOG_LEVEL` as needed.

**Split testing:** run the **seller** on the server and **buyer smoke** from your laptop (or both on the server) — ensure `TARGET_PROVIDER_AGENT_WALLET_ADDRESS` points at the seller agent you intend to hit.

### GCP / `gcloud compute ssh` and IAP

If SSH uses `--tunnel-through-iap`, your Google account needs IAM that includes **`compute.projects.get`** on the target project (commonly via a **Google group** bound to Compute/Project Viewer or similar). If that error appears after re-auth, it is **project IAM**, not a broken `gcloud` login.

Template (fill project, zone, instance):

```bash
gcloud compute ssh --zone "<zone>" "<instance-name>" \
  --tunnel-through-iap --project "<gcp-project-id>"
```

---

## Conventions for changes

- Keep diffs focused; match existing patterns in `src/` (logging, offering loader, handler shapes).
- Do not add secrets to the repo; document new env vars in `.env.example` when needed.
