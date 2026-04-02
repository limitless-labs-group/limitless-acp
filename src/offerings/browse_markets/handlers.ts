import { LimitlessClient } from "../../limitless/markets.js";
import type {
  ExecuteJobResult,
  JobContext,
  ValidationResult,
} from "../../acpTypes.js";

const client = new LimitlessClient();

export function validateRequirements(
  request: Record<string, unknown>,
): ValidationResult {
  if (request.limit !== undefined) {
    const limit = Number(request.limit);
    if (isNaN(limit) || limit < 1) {
      return { valid: false, reason: "limit must be a positive number" };
    }
  }
  return true;
}

export async function executeJob(
  request: Record<string, unknown>,
  _context: JobContext,
): Promise<ExecuteJobResult> {
  const query = request.query as string | undefined;
  const tradeType = request.tradeType as "amm" | "clob" | "group" | undefined;
  const limit = Math.min(Number(request.limit) || 20, 50);

  let markets;
  if (query) {
    markets = await client.searchMarkets(query, { limit });
  } else {
    markets = await client.getActiveMarkets({ tradeType, limit });
  }

  const summary = markets.map((m) => ({
    marketId: m.slug,
    question: m.title,
    isOpen: m.status === "FUNDED",
    outcomes: m.prices.map((price, i) => ({
      name: i === 0 ? "YES" : "NO",
      odds: price / 100,
    })),
    closesAt: m.expirationTimestamp
      ? new Date(m.expirationTimestamp * 1000).toISOString()
      : null,
    volume: m.volumeFormatted ?? m.volume,
    liquidity: m.liquidityFormatted ?? m.liquidity,
    tradeType: m.tradeType,
  }));

  return {
    deliverable: JSON.stringify({ markets: summary }),
  };
}
