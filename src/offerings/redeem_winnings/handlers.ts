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

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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
    marketSlug: string;
    txHash: string;
    payout: string;
    ledgerEntryId: string;
  }[] = [];
  let totalPayout = 0;

  for (const position of toRedeem) {
    try {
      const result = await redeemClient.redeemSingle(position.marketSlug);
      const payoutNum = parseFloat(result.payout);

      updatePosition(position.id, {
        status: "redeemed",
        redeemedAt: new Date().toISOString(),
        redeemTxHash: result.txHash,
        payoutUsd: payoutNum,
      });

      redeemed.push({
        marketSlug: position.marketSlug,
        txHash: result.txHash,
        payout: result.payout,
        ledgerEntryId: position.id,
      });

      totalPayout += payoutNum;

      logger.info(
        {
          market: position.marketSlug,
          payout: result.payout,
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

  const deliverable = JSON.stringify({
    redeemed,
    totalPayout: Math.round(totalPayout * 100) / 100,
  });

  if (totalPayout > 0) {
    return {
      deliverable,
      payableDetail: {
        tokenAddress: USDC_ADDRESS,
        amount: totalPayout,
      },
    };
  }

  return { deliverable };
}
