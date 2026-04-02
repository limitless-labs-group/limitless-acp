import { RedeemClient } from "../../limitless/redeem.js";
import {
  getRedeemablePositions,
  updatePosition,
} from "../../ledger.js";
import { logger } from "../../logger.js";
import type {
  ExecuteJobResult,
  JobContext,
  ValidationResult,
} from "../../acpTypes.js";

const redeemClient = new RedeemClient();

export function validateRequirements(
  request: Record<string, unknown>,
): ValidationResult {
  if (request.marketSlug !== undefined && typeof request.marketSlug !== "string") {
    return { valid: false, reason: "marketSlug must be a string" };
  }
  return true;
}

export async function executeJob(
  request: Record<string, unknown>,
  context: JobContext,
): Promise<ExecuteJobResult> {
  const marketSlug = request.marketSlug as string | undefined;
  const positions = getRedeemablePositions(context.clientAddress);

  const toRedeem = marketSlug
    ? positions.filter((p) => p.marketSlug === marketSlug)
    : positions;

  if (toRedeem.length === 0) {
    return {
      deliverable: JSON.stringify({
        redeemed: [],
        totalPayout: 0,
        message: "No redeemable positions found",
      }),
    };
  }

  const redeemed: {
    positionId: string;
    marketId: string;
    txHash: string;
    usdPayout: number;
    resolvedAt: string;
    resultStatus: string;
  }[] = [];
  let totalPayout = 0;

  for (const position of toRedeem) {
    try {
      const result = await redeemClient.redeemSingle(position.marketSlug);
      const payoutNum = parseFloat(result.payout);
      const resolvedAt = new Date().toISOString();

      updatePosition(position.id, {
        status: "redeemed",
        redeemedAt: resolvedAt,
        redeemTxHash: result.txHash,
        payoutUsd: payoutNum,
      });

      redeemed.push({
        positionId: `pred_pos_${position.id}`,
        marketId: position.marketSlug,
        txHash: result.txHash,
        usdPayout: payoutNum,
        resolvedAt,
        resultStatus: payoutNum > position.amountUsd ? "Won" : "Lost",
      });

      totalPayout += payoutNum;

      logger.info(
        {
          market: position.marketSlug,
          usdPayout: payoutNum,
          txHash: result.txHash,
        },
        "Position redeemed",
      );
    } catch (err) {
      logger.error(
        { market: position.marketSlug, err },
        "Failed to redeem position",
      );
    }
  }

  const roundedPayout = Math.round(totalPayout * 100) / 100;

  return {
    deliverable: JSON.stringify({
      redeemed,
      usdTotalPayout: roundedPayout,
    }),
    returnAmount: roundedPayout > 0 ? roundedPayout : undefined,
  };
}
