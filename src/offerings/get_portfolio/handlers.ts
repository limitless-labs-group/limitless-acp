import { LimitlessClient } from "../../limitless/markets.js";
import { getPositionsByBuyer } from "../../ledger.js";
import { logger } from "../../logger.js";
import type { ExecuteJobResult, JobContext } from "../../acpTypes.js";

const client = new LimitlessClient();

export async function executeJob(
  request: Record<string, unknown>,
  context: JobContext,
): Promise<ExecuteJobResult> {
  const includeHistory = request.includeHistory === true;
  const positions = getPositionsByBuyer(context.clientAddress);

  const activePositions = positions.filter((p) => p.status === "filled");

  const enriched = await Promise.all(
    activePositions.map(async (pos) => {
      try {
        const market = await client.getMarket(pos.marketSlug);
        const sideIndex = pos.side === "YES" ? 0 : 1;
        const currentPrice = market.prices[sideIndex];
        const costBasis = pos.limitPriceCents / 100;
        const currentValue = (currentPrice / 100) * pos.amountUsd / costBasis;
        const unrealizedPnl = currentValue - pos.amountUsd;

        return {
          ...pos,
          marketTitle: market.title,
          currentPriceCents: currentPrice,
          currentValue: Math.round(currentValue * 100) / 100,
          unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
          marketStatus: market.status,
        };
      } catch (err) {
        logger.warn(
          { slug: pos.marketSlug, err },
          "Failed to enrich position with market data",
        );
        return { ...pos, marketTitle: pos.marketSlug };
      }
    }),
  );

  const totalInvested = activePositions.reduce(
    (sum, p) => sum + p.amountUsd,
    0,
  );
  const totalCurrentValue = enriched.reduce(
    (sum, p) => sum + ((p as { currentValue?: number }).currentValue ?? p.amountUsd),
    0,
  );

  const result: Record<string, unknown> = {
    positions: enriched,
    summary: {
      totalPositions: activePositions.length,
      totalInvested: Math.round(totalInvested * 100) / 100,
      currentValue: Math.round(totalCurrentValue * 100) / 100,
      unrealizedPnl:
        Math.round((totalCurrentValue - totalInvested) * 100) / 100,
    },
  };

  if (includeHistory) {
    result.history = positions.filter(
      (p) => p.status === "redeemed" || p.status === "failed",
    );
  }

  return {
    deliverable: JSON.stringify(result),
  };
}
