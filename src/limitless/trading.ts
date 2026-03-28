import fetch from "cross-fetch";
import crypto from "crypto";
import { LimitlessClient } from "./markets.js";
import { OrderSigner } from "./sign.js";
import { logger } from "../logger.js";

const API_BASE_DEFAULT = "https://api.limitless.exchange";

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

export class TradingClient {
  private cachedUserId?: number;
  private marketDetailCache: Map<string, { market: unknown; fetchedAt: number }> =
    new Map();
  private readonly MARKET_DETAIL_TTL = 120000;
  private lastOrderTime = 0;
  private orderSemaphore = new Semaphore(2);

  constructor(
    private client: LimitlessClient,
    private signer: OrderSigner,
    private baseUrl: string = process.env.LIMITLESS_API_URL || API_BASE_DEFAULT,
  ) {}

  private get headers() {
    const apiKey = process.env.LIMITLESS_API_KEY;
    return {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    };
  }

  async getUserId(walletAddress: string): Promise<number> {
    if (this.cachedUserId) return this.cachedUserId;

    const url = `${this.baseUrl}/profiles/${walletAddress}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
    const profile = await res.json();
    this.cachedUserId = profile.id;
    logger.info(
      { userId: profile.id, wallet: walletAddress },
      "Got user profile",
    );
    return profile.id;
  }

  async createOrder(params: {
    marketSlug: string;
    side: "YES" | "NO";
    limitPriceCents: number;
    usdAmount: number;
    orderType?: "GTC" | "FOK";
  }): Promise<Record<string, unknown>> {
    const {
      marketSlug,
      side,
      limitPriceCents,
      usdAmount,
      orderType = "FOK",
    } = params;

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

    const cached = this.marketDetailCache.get(marketSlug);
    let market: Record<string, unknown>;
    if (cached && Date.now() - cached.fetchedAt < this.MARKET_DETAIL_TTL) {
      market = cached.market as Record<string, unknown>;
    } else {
      market = (await this.client.getMarket(marketSlug)) as unknown as Record<
        string,
        unknown
      >;
      this.marketDetailCache.set(marketSlug, {
        market,
        fetchedAt: Date.now(),
      });
    }
    if (!market.venue) throw new Error(`Market ${marketSlug} has no venue`);
    const positionIds = market.positionIds as string[];
    if (!positionIds || positionIds.length < 2) {
      throw new Error(`Market ${marketSlug} has invalid position IDs`);
    }

    const tokenId = side === "YES" ? positionIds[0] : positionIds[1];
    const price = limitPriceCents / 100;

    let makerAmount: bigint;
    let takerAmount: bigint;

    if (orderType === "FOK") {
      makerAmount = BigInt(Math.round(usdAmount * 1_000_000));
      takerAmount = 1n;
    } else {
      const TICK_SIZE = 1000n;
      const SCALE = 1_000_000n;

      const rawContracts = BigInt(
        Math.floor((usdAmount * 1_000_000) / price),
      );
      takerAmount = (rawContracts / TICK_SIZE) * TICK_SIZE;

      const priceScaled = BigInt(Math.floor(price * 1_000_000));
      makerAmount = (takerAmount * priceScaled) / SCALE;
    }

    const userId = await this.getUserId(this.signer.getAddress());

    const venue = market.venue as { exchange: string; adapter: string };
    const signedOrder = await this.signer.signOrder(venue, {
      tokenId,
      makerAmount,
      takerAmount,
      side: "BUY",
    });

    const orderBody: Record<string, unknown> = {
      order: {
        salt: Number(signedOrder.salt),
        maker: signedOrder.maker,
        signer: signedOrder.signer,
        taker: signedOrder.taker,
        tokenId: signedOrder.tokenId,
        makerAmount: Number(signedOrder.makerAmount),
        takerAmount: Number(signedOrder.takerAmount),
        expiration: signedOrder.expiration,
        nonce: signedOrder.nonce,
        feeRateBps: signedOrder.feeRateBps,
        side: signedOrder.side,
        signatureType: signedOrder.signatureType,
        signature: signedOrder.signature,
        ...(orderType === "GTC" ? { price } : {}),
      },
      orderType,
      marketSlug,
      ownerId: userId,
      clientOrderId: `${marketSlug}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    };

    const url = `${this.baseUrl}/orders`;
    logger.info(
      {
        slug: marketSlug,
        side,
        price,
        usdAmount,
        orderType,
        clientOrderId: orderBody.clientOrderId,
      },
      "Submitting order",
    );

    if (process.env.DRY_RUN === "true") {
      logger.info({ slug: marketSlug }, "DRY RUN: Order execution skipped");
      return { status: "DRY_RUN", order: signedOrder };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(orderBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      const lowerErr = errText.toLowerCase();
      const isApprovalIssue =
        lowerErr.includes("allowance") ||
        lowerErr.includes("not approved") ||
        lowerErr.includes("approval") ||
        lowerErr.includes("insufficient") ||
        res.status === 403;

      if (isApprovalIssue) {
        throw new Error(
          `Market not approved. Run: npm run approve ${marketSlug}\n` +
            `  (Original error: ${res.status} ${errText})`,
        );
      }

      throw new Error(
        `Order submission failed [${orderType}]: ${res.status} ${errText}`,
      );
    }

    return (await res.json()) as Record<string, unknown>;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const url = `${this.baseUrl}/orders/${orderId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok)
      throw new Error(`Failed to cancel order ${orderId}: ${res.status}`);
  }
}
