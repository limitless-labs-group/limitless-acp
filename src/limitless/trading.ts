import {
  OrderType,
  Side,
  type CreateOrderParams,
} from "@limitless-exchange/sdk";
import { LimitlessClient } from "./markets.js";
import { getOrderClient } from "./sdk.js";
import { logger } from "../logger.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.active < this.max) {
        this.active++;
        resolve();
      } else {
        this.queue.push(() => {
          this.active++;
          resolve();
        });
      }
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const DEDUPE_WINDOW_MS = 30_000;

export class TradingClient {
  private lastOrderTime = 0;
  private orderSemaphore = new Semaphore(2);
  private recentOrders = new Map<string, number>();

  constructor(private client: LimitlessClient = new LimitlessClient()) {}

  async createOrder(params: {
    marketSlug: string;
    side: "YES" | "NO";
    limitPriceCents: number;
    usdAmount: number;
    orderType?: "GTC" | "FOK";
    /**
     * Stable identity for this order intent (e.g. the ACP job id). Two
     * createOrder calls with the same key are treated as one intent: the
     * second is rejected. Without a key, an identical
     * market/side/amount/type fingerprint within 30s is rejected instead.
     */
    dedupeKey?: string;
  }): Promise<Record<string, unknown>> {
    const {
      marketSlug,
      side,
      limitPriceCents,
      usdAmount,
      orderType = "FOK",
      dedupeKey,
    } = params;

    const key = dedupeKey ?? `${marketSlug}|${side}|${usdAmount}|${orderType}`;
    const priorAt = this.recentOrders.get(key);
    if (
      priorAt !== undefined &&
      (dedupeKey || Date.now() - priorAt < DEDUPE_WINDOW_MS)
    ) {
      throw new Error(
        `Duplicate order suppressed (${key} already submitted ${Math.round(
          (Date.now() - priorAt) / 1000,
        )}s ago)`,
      );
    }
    for (const [k, t] of this.recentOrders) {
      if (Date.now() - t > 3_600_000) this.recentOrders.delete(k);
    }
    this.recentOrders.set(key, Date.now());

    await this.orderSemaphore.acquire();
    try {
      const waitMs = Math.max(0, 300 - (Date.now() - this.lastOrderTime));
      if (waitMs > 0) {
        logger.debug({ waitMs }, "Rate limiting: sleeping before order");
        await sleep(waitMs);
      }
      return await this._submitOrder({
        marketSlug,
        side,
        limitPriceCents,
        usdAmount,
        orderType,
      });
    } catch (err) {
      // Failed submissions may be retried legitimately; free the key.
      this.recentOrders.delete(key);
      throw err;
    } finally {
      this.lastOrderTime = Date.now();
      this.orderSemaphore.release();
    }
  }

  private async _submitOrder(params: {
    marketSlug: string;
    side: "YES" | "NO";
    limitPriceCents: number;
    usdAmount: number;
    orderType: "GTC" | "FOK";
  }): Promise<Record<string, unknown>> {
    const { marketSlug, side, limitPriceCents, usdAmount, orderType } = params;

    // Warms the SDK venue cache so the order client signs without extra fetches.
    const market = await this.client.getMarket(marketSlug);
    if (!market.venue) throw new Error(`Market ${marketSlug} has no venue`);
    const positionIds = market.positionIds;
    if (!positionIds || positionIds.length < 2) {
      throw new Error(`Market ${marketSlug} has invalid position IDs`);
    }

    const tokenId = side === "YES" ? positionIds[0] : positionIds[1];
    const price = limitPriceCents / 100;

    let orderParams: CreateOrderParams;
    if (orderType === "FOK") {
      // FOK BUY: makerAmount is the USDC amount to spend (human units, max 6 decimals)
      orderParams = {
        orderType: OrderType.FOK,
        marketSlug,
        tokenId,
        side: Side.BUY,
        makerAmount: Math.floor(usdAmount * 1_000_000) / 1_000_000,
      };
    } else {
      // GTC: price per share + share count, floored to 0.001-share increments
      const size = Math.floor((usdAmount / price) * 1000) / 1000;
      if (size <= 0) {
        throw new Error(
          `Amount ${usdAmount} too small for a GTC order at price ${price}`,
        );
      }
      orderParams = {
        orderType: OrderType.GTC,
        marketSlug,
        tokenId,
        side: Side.BUY,
        price,
        size,
      };
    }

    logger.info(
      { slug: marketSlug, side, price, usdAmount, orderType },
      "Submitting order",
    );

    if (process.env.DRY_RUN === "true") {
      logger.info({ slug: marketSlug }, "DRY RUN: Order execution skipped");
      return { status: "DRY_RUN", order: orderParams };
    }

    try {
      const res = await getOrderClient().createOrder(orderParams);
      return {
        id: res.order.id,
        order: res.order,
        makerMatches: res.makerMatches,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      const lowerErr = message.toLowerCase();
      const isApprovalIssue =
        lowerErr.includes("allowance") ||
        lowerErr.includes("not approved") ||
        lowerErr.includes("approval") ||
        lowerErr.includes("insufficient") ||
        status === 403;

      if (isApprovalIssue) {
        throw new Error(
          `Market not approved. Run: npm run approve ${marketSlug}\n` +
            `  (Original error: ${status ?? ""} ${message})`,
        );
      }

      throw new Error(
        `Order submission failed [${orderType}]: ${status ?? ""} ${message}`,
      );
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await getOrderClient().cancel(orderId);
  }
}
