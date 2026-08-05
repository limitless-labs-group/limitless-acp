#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import { loadOffering } from "../offeringLoader.js";
import type { JobContext } from "../acpTypes.js";

function parseJsonEnv(
  key: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function defaultRequirement(offering: string): Record<string, unknown> {
  switch (offering) {
    case "browse_markets":
      return { query: process.env.SELLER_SMOKE_QUERY || "BTC", limit: 5 };
    case "get_portfolio":
      return { includeHistory: process.env.SELLER_SMOKE_INCLUDE_HISTORY === "true" };
    case "redeem_winnings":
      return process.env.SELLER_SMOKE_MARKET_SLUG
        ? { marketSlug: process.env.SELLER_SMOKE_MARKET_SLUG }
        : {};
    case "place_bet": {
      const slug = process.env.SELLER_SMOKE_MARKET_SLUG;
      if (!slug) {
        throw new Error("place_bet requires SELLER_SMOKE_MARKET_SLUG");
      }
      return {
        marketSlug: slug,
        side: process.env.SELLER_SMOKE_SIDE || "YES",
        amount: Number.parseFloat(process.env.SELLER_SMOKE_AMOUNT || "0.1"),
        orderType: process.env.SELLER_SMOKE_ORDER_TYPE || "FOK",
      };
    }
    default:
      return {};
  }
}

async function main() {
  const offeringName = process.env.SELLER_SMOKE_OFFERING?.trim() || "browse_markets";
  const compact = process.env.SELLER_SMOKE_COMPACT !== "false";

  const { config, handlers } = await loadOffering(offeringName);
  const requirement = parseJsonEnv(
    "SELLER_SMOKE_REQUIREMENT_JSON",
    defaultRequirement(offeringName),
  );

  const context: JobContext = {
    jobId: Number.parseInt(process.env.SELLER_SMOKE_JOB_ID || "999001", 10),
    clientAddress:
      process.env.SELLER_SMOKE_CLIENT_ADDRESS ||
      "0x1111111111111111111111111111111111111111",
    providerAddress:
      process.env.SELLER_SMOKE_PROVIDER_ADDRESS ||
      "0x2222222222222222222222222222222222222222",
    netPayableAmount: process.env.SELLER_SMOKE_NET_PAYABLE
      ? Number.parseFloat(process.env.SELLER_SMOKE_NET_PAYABLE)
      : undefined,
  };

  if (handlers.validateRequirements) {
    const validation = await handlers.validateRequirements(requirement);
    const valid = typeof validation === "boolean" ? validation : validation.valid;
    if (!valid) {
      const reason =
        typeof validation === "boolean" ? "Validation failed" : validation.reason;
      throw new Error(`Validation failed: ${reason ?? "Unknown reason"}`);
    }
  }

  let requiredFunds: { amount: number; reason: string } | undefined;
  if (config.requiredFunds && handlers.getRequiredFunds) {
    requiredFunds = await handlers.getRequiredFunds(requirement);
  }

  const startedAt = Date.now();
  const result = await handlers.executeJob(requirement, context);
  const elapsedMs = Date.now() - startedAt;

  if (compact) {
    let detail = "";
    try {
      const parsed = JSON.parse(result.deliverable || "{}") as Record<string, unknown>;
      if (Array.isArray(parsed.markets)) detail = ` markets=${parsed.markets.length}`;
      else if (Array.isArray(parsed.positions))
        detail = ` positions=${parsed.positions.length}`;
      else if (Array.isArray(parsed.redeemed)) detail = ` redeemed=${parsed.redeemed.length}`;
    } catch {
      /* no-op */
    }
    console.log(
      `[SELLER_SMOKE] offering=${offeringName} status=${
        result.error ? "ERROR" : "OK"
      } elapsedMs=${elapsedMs}${detail}${requiredFunds ? ` requiredFunds=${requiredFunds.amount}` : ""}`,
    );
    if (result.error) {
      console.log(`[SELLER_SMOKE] reason=${result.error.reason}`);
    }
    return;
  }

  console.log("offering:", offeringName);
  console.log("requirement:", requirement);
  if (requiredFunds) console.log("requiredFunds:", requiredFunds);
  console.log("result:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
