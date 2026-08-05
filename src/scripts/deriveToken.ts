#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import { Client, ScopeTrading } from "@limitless-exchange/sdk";
import { logger } from "../logger.js";

// Derives a scoped HMAC API token for the Limitless trading account.
// The identity token must belong to the Limitless account of the TRADING
// EOA (the wallet behind PRIVATE_KEY), not the ACP agent smart wallet.

async function main() {
  const identityToken =
    process.argv[2] || process.env.LIMITLESS_IDENTITY_TOKEN?.trim();

  if (!identityToken) {
    console.error(
      [
        "Usage: npm run derive-token -- <privy-identity-token>",
        "",
        "How to get the identity token:",
        "  1. Log in to https://limitless.exchange in a browser using the",
        "     Limitless TRADING wallet (the EOA behind PRIVATE_KEY).",
        "  2. Open devtools > Application > Cookies and copy the value of",
        "     the 'privy-id-token' cookie (or the identity token from an",
        "     authenticated request's headers).",
        "  3. Run this script with that token. The token is short-lived;",
        "     derive promptly after copying.",
        "",
        "The derived tokenId/secret are printed ONCE. Store them in .env as",
        "LIMITLESS_HMAC_TOKEN_ID / LIMITLESS_HMAC_SECRET.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const baseURL = process.env.LIMITLESS_API_URL?.trim();
  const client = new Client({ ...(baseURL ? { baseURL } : {}) });

  const scopes = (process.env.LIMITLESS_TOKEN_SCOPES || ScopeTrading)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const derived = await client.apiTokens.deriveToken(identityToken, {
    label: process.env.LIMITLESS_TOKEN_LABEL || "limitless-acp-seller",
    scopes,
  });

  logger.info(
    {
      tokenId: derived.tokenId,
      scopes: derived.scopes,
      profileId: derived.profile?.id,
      profileAccount: derived.profile?.account,
      createdAt: derived.createdAt,
    },
    "Derived scoped API token",
  );

  const expected = process.env.PRIVATE_KEY
    ? "(verify profileAccount matches your trading wallet address)"
    : "";

  console.log(
    [
      "",
      "Scoped API token derived. The secret is shown ONCE — save it now.",
      `Token profile account: ${derived.profile?.account} ${expected}`,
      "",
      "Add to .env:",
      `LIMITLESS_HMAC_TOKEN_ID=${derived.tokenId}`,
      `LIMITLESS_HMAC_SECRET=${derived.secret}`,
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to derive API token");
  process.exit(1);
});
