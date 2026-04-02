import { LimitlessClient } from "../../limitless/markets.js";
import { TradingClient } from "../../limitless/trading.js";
import { OrderSigner } from "../../limitless/sign.js";
import { ensureMarketApproved } from "../../limitless/approve.js";
import { getWallet } from "../../limitless/wallet.js";
import { addPosition } from "../../ledger.js";
import { logger } from "../../logger.js";
import type {
  ExecuteJobResult,
  JobContext,
  ValidationResult,
  RequiredFunds,
} from "../../acpTypes.js";

const client = new LimitlessClient();
const { client: walletClient, account } = getWallet();
const signer = new OrderSigner(walletClient, account);
const tradingClient = new TradingClient(client, signer);

export async function validateRequirements(
  request: Record<string, unknown>,
): Promise<ValidationResult> {
  const { marketSlug, side, amount, limitPriceCents } = request as {
    marketSlug?: string;
    side?: string;
    amount?: number;
    limitPriceCents?: number;
  };

  if (!marketSlug || typeof marketSlug !== "string") {
    return { valid: false, reason: "marketSlug is required" };
  }
  if (side !== "YES" && side !== "NO") {
    return { valid: false, reason: "side must be YES or NO" };
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return { valid: false, reason: "amount must be a positive number" };
  }
  if (
    limitPriceCents !== undefined &&
    (limitPriceCents < 1 || limitPriceCents > 99)
  ) {
    return { valid: false, reason: "limitPriceCents must be between 1 and 99" };
  }

  try {
    const market = await client.getMarket(marketSlug);
    if (market.status !== "FUNDED") {
      return {
        valid: false,
        reason: `Market is not active (status: ${market.status})`,
      };
    }
  } catch {
    return { valid: false, reason: `Market "${marketSlug}" not found` };
  }

  return true;
}

export async function getRequiredFunds(
  request: Record<string, unknown>,
): Promise<RequiredFunds> {
  const amount = request.amount as number;
  const marketSlug = request.marketSlug as string;

  return {
    amount,
    reason: `Transfer ${amount} USDC for prediction market bet on "${marketSlug}"`,
  };
}

export async function executeJob(
  request: Record<string, unknown>,
  context: JobContext,
): Promise<ExecuteJobResult> {
  const marketSlug = request.marketSlug as string;
  const side = request.side as "YES" | "NO";
  const orderType = (request.orderType as "GTC" | "FOK") || "FOK";

  const tradeAmount = context.netPayableAmount ?? (request.amount as number);

  let limitPriceCents = request.limitPriceCents as number | undefined;

  try {
    if (!limitPriceCents) {
      const market = await client.getMarket(marketSlug);
      const sideIndex = side === "YES" ? 0 : 1;
      limitPriceCents = Math.ceil(market.prices[sideIndex]);
      if (limitPriceCents < 1) limitPriceCents = 1;
      if (limitPriceCents > 99) limitPriceCents = 99;
    }

    await ensureMarketApproved(marketSlug);

    const result = await tradingClient.createOrder({
      marketSlug,
      side,
      limitPriceCents,
      usdAmount: tradeAmount,
      orderType,
    });

    const orderId =
      (result.id as string) ??
      (result.orderId as string) ??
      (result.clientOrderId as string);

    const entry = addPosition({
      buyerAddress: context.clientAddress,
      acpJobId: context.jobId,
      marketSlug,
      side,
      amountUsd: tradeAmount,
      limitPriceCents,
      orderType,
      status: "filled",
      orderId,
    });

    logger.info(
      { jobId: context.jobId, orderId, ledgerEntryId: entry.id },
      "Bet placed and recorded",
    );

    return {
      deliverable: JSON.stringify({
        status: "filled",
        positionId: `pred_pos_${entry.id}`,
        marketId: marketSlug,
        outcome: side,
        usdStake: tradeAmount,
        entryPrice: limitPriceCents / 100,
        orderType,
        orderId,
        openedAt: entry.createdAt,
      }),
    };
  } catch (err) {
    logger.error({ jobId: context.jobId, err }, "Failed to place bet");

    addPosition({
      buyerAddress: context.clientAddress,
      acpJobId: context.jobId,
      marketSlug,
      side,
      amountUsd: tradeAmount,
      limitPriceCents: limitPriceCents ?? 0,
      orderType,
      status: "failed",
    });

    const errorMsg = err instanceof Error ? err.message : String(err);

    return {
      deliverable: "",
      error: {
        reason: `Failed to place bet on "${marketSlug}": ${errorMsg}`,
        refundAmount: tradeAmount,
      },
    };
  }
}
