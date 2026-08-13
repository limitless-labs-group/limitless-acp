#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import { RedeemClient } from "../limitless/redeem.js";
import { logger } from "../logger.js";

// Usage:
//   npm run redeem                  — scan and list claimable positions
//   npm run redeem -- <marketSlug>  — redeem one market (works even if the
//                                     portfolio API no longer lists it)

async function main() {
  const slug = process.argv[2]?.trim();
  const client = new RedeemClient();

  if (!slug) {
    const claimable = await client.scanRedeemable();
    if (claimable.length === 0) {
      console.log(
        "No claimable positions found via the portfolio API. " +
          "If you expect winnings from an older market, pass its slug " +
          "explicitly: npm run redeem -- <marketSlug>",
      );
      return;
    }
    for (const c of claimable) {
      console.log(
        `claimable: ${c.marketSlug} side=${c.side} expectedPayout=${c.expectedPayout} USDC`,
      );
    }
    return;
  }

  const result = await client.redeemSingle(slug);
  console.log(
    `Redeemed ${slug}: payout=${result.payout} USDC tx=${result.txHash}`,
  );
}

main().catch((err) => {
  logger.error({ err }, "Redeem failed");
  process.exit(1);
});
