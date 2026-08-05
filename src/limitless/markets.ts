import { Market, MarketDetail, Orderbook } from "./types.js";
import { getSdkClient } from "./sdk.js";
import { logger } from "../logger.js";

function normalizePositionIds<T extends Partial<Market>>(m: T): T {
  const tokens = (m as { tokens?: { yes: string; no: string } }).tokens;
  if (tokens && !m.positionIds) {
    m.positionIds = [tokens.yes, tokens.no];
  }
  return m;
}

export class LimitlessClient {
  private get sdk() {
    return getSdkClient();
  }

  async getActiveMarkets(
    options: {
      category?: number;
      tradeType?: "amm" | "clob" | "group";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Market[]> {
    const params: Record<string, string | number> = {};
    if (options.category) params.category = options.category;
    if (options.tradeType) params.tradeType = options.tradeType;
    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;

    logger.debug({ params }, "Fetching active markets");
    const data = await this.sdk.http.get<{ data?: Market[] }>(
      "/markets/active",
      { params },
    );

    const markets = data.data || [];
    return markets.map((m) => normalizePositionIds(m));
  }

  async searchMarkets(
    query: string,
    options: {
      similarityThreshold?: number;
      limit?: number;
      page?: number;
    } = {},
  ): Promise<Market[]> {
    const params: Record<string, string | number> = { query };
    if (options.similarityThreshold)
      params.similarityThreshold = options.similarityThreshold;
    if (options.limit) params.limit = options.limit;
    if (options.page) params.page = options.page;

    logger.debug({ query }, "Searching markets");
    const data = await this.sdk.http.get<
      Market[] | { markets?: Market[]; data?: Market[] }
    >("/markets/search", { params });

    const markets = Array.isArray(data)
      ? data
      : data.markets || data.data || [];
    return markets.map((m) => normalizePositionIds(m));
  }

  async getMarket(slug: string): Promise<MarketDetail> {
    logger.debug({ slug }, "Fetching market detail");
    // Fetching via the SDK warms its venue cache, which the shared order
    // client reuses when signing and submitting orders for this market.
    const market = await this.sdk.markets.getMarket(slug);
    return normalizePositionIds(market as unknown as MarketDetail);
  }

  async getOrderbook(slug: string): Promise<Orderbook> {
    return (await this.sdk.markets.getOrderBook(slug)) as unknown as Orderbook;
  }

  async getVenue(slug: string): Promise<Market["venue"]> {
    const cached = this.sdk.markets.getVenue(slug);
    if (cached) return cached as Market["venue"];
    const market = await this.getMarket(slug);
    return market.venue;
  }
}
