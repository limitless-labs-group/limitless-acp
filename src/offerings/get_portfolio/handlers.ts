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
        const currentOdds = market.prices[sideIndex] / 100;
        const entryPrice = pos.limitPriceCents / 100;
        const usdCurrentValue =
          Math.round((currentOdds * pos.amountUsd / entryPrice) * 100) / 100;
        const usdUnrealizedPnl =
          Math.round((usdCurrentValue - pos.amountUsd) * 100) / 100;
        const usdPotentialPayout =
          Math.round((pos.amountUsd / entryPrice) * 100) / 100;
        const closesAt = market.expirationTimestamp
          ? new Date(market.expirationTimestamp * 1000).toISOString()
          : null;

        return {
          positionId: `pred_pos_${pos.id}`,
          marketId: pos.marketSlug,
          question: market.title,
          outcome: pos.side,
          usdStake: pos.amountUsd,
          entryPrice,
          currentPrice: currentOdds,
          usdPotentialPayout,
          usdCurrentValue,
          usdUnrealizedPnl,
          openedAt: pos.createdAt,
          resolveBy: closesAt,
          isOpen: market.status === "FUNDED",
        };
      } catch (err) {
        logger.warn(
          { slug: pos.marketSlug, err },
          "Failed to enrich position with market data",
        );
        return {
          positionId: `pred_pos_${pos.id}`,
          marketId: pos.marketSlug,
          question: pos.marketSlug,
          outcome: pos.side,
          usdStake: pos.amountUsd,
          entryPrice: pos.limitPriceCents / 100,
          openedAt: pos.createdAt,
        };
      }
    }),
  );

  const totalInvested = activePositions.reduce(
    (sum, p) => sum + p.amountUsd,
    0,
  );
  const totalCurrentValue = enriched.reduce(
    (sum, p) =>
      sum + ((p as { usdCurrentValue?: number }).usdCurrentValue ?? p.usdStake),
    0,
  );

  const result: Record<string, unknown> = {
    clientAddress: context.clientAddress,
    positions: enriched,
    summary: {
      totalPositions: activePositions.length,
      usdTotalInvested: Math.round(totalInvested * 100) / 100,
      usdCurrentValue: Math.round(totalCurrentValue * 100) / 100,
      usdUnrealizedPnl:
        Math.round((totalCurrentValue - totalInvested) * 100) / 100,
    },
    lastUpdatedAt: new Date().toISOString(),
  };

  if (includeHistory) {
    const historical = positions
      .filter((p) => p.status === "redeemed" || p.status === "failed")
      .map((p) => ({
        positionId: `pred_pos_${p.id}`,
        marketId: p.marketSlug,
        outcome: p.side,
        usdStake: p.amountUsd,
        entryPrice: p.limitPriceCents / 100,
        usdPayout: p.payoutUsd ?? 0,
        resolvedAt: p.redeemedAt ?? null,
        resultStatus:
          p.status === "redeemed"
            ? (p.payoutUsd && p.payoutUsd > p.amountUsd ? "Won" : "Lost")
            : "Failed",
      }));
    result.historicalPositions = historical;
  }

  return {
    deliverable: JSON.stringify(result),
  };
}
