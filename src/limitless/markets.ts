import fetch from "cross-fetch";
import { Market, MarketDetail, Orderbook } from "./types.js";
import { logger } from "../logger.js";

const API_BASE =
  process.env.LIMITLESS_API_URL || "https://api.limitless.exchange";

function getHeaders() {
  const apiKey = process.env.LIMITLESS_API_KEY;
  if (!apiKey) {
    logger.warn("LIMITLESS_API_KEY is not set. Some endpoints may fail.");
  }
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
}

export class LimitlessClient {
  private venueCache: Map<string, Market["venue"]> = new Map();

  constructor(private baseUrl: string = API_BASE) {}

  async getActiveMarkets(
    options: {
      category?: number;
      tradeType?: "amm" | "clob" | "group";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Market[]> {
    const params = new URLSearchParams();
    if (options.category)
      params.append("category", options.category.toString());
    if (options.tradeType) params.append("tradeType", options.tradeType);
    if (options.limit) params.append("limit", options.limit.toString());
    if (options.offset) params.append("offset", options.offset.toString());

    const url = `${this.baseUrl}/markets/active?${params.toString()}`;
    logger.debug({ url }, "Fetching active markets");
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch markets: ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    const markets = data.data || [];

    markets.forEach((m: Market) => {
      if (m.slug && m.venue) {
        this.venueCache.set(m.slug, m.venue);
      }
    });

    return markets.map((m: any) => ({
      ...m,
      positionIds: m.tokens
        ? [m.tokens.yes, m.tokens.no]
        : m.positionIds,
    })) as Market[];
  }

  async searchMarkets(
    query: string,
    options: {
      similarityThreshold?: number;
      limit?: number;
      page?: number;
    } = {},
  ): Promise<Market[]> {
    const params = new URLSearchParams();
    params.append("query", query);
    if (options.similarityThreshold)
      params.append(
        "similarityThreshold",
        options.similarityThreshold.toString(),
      );
    if (options.limit) params.append("limit", options.limit.toString());
    if (options.page) params.append("page", options.page.toString());

    const url = `${this.baseUrl}/markets/search?${params.toString()}`;
    logger.debug({ url, query }, "Searching markets");
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      throw new Error(
        `Failed to search markets: ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    const markets = Array.isArray(data)
      ? data
      : data.markets || data.data || [];

    markets.forEach((m: Market) => {
      if (m.slug && m.venue) {
        this.venueCache.set(m.slug, m.venue);
      }
    });

    return markets;
  }

  async getMarket(slug: string): Promise<MarketDetail> {
    const url = `${this.baseUrl}/markets/${slug}`;
    logger.debug({ url }, "Fetching market detail");
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch market ${slug}: ${res.status} ${res.statusText}`,
      );
    }

    const market = (await res.json()) as MarketDetail;

    if (market.venue) {
      this.venueCache.set(slug, market.venue);
    }

    if (
      (market as any).tokens &&
      !market.positionIds
    ) {
      const tokens = (market as any).tokens as Record<string, string>;
      market.positionIds = [tokens.yes, tokens.no];
    }

    return market;
  }

  async getOrderbook(slug: string): Promise<Orderbook> {
    const url = `${this.baseUrl}/markets/${slug}/orderbook`;
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      throw new Error(`Failed to fetch orderbook for ${slug}`);
    }

    return (await res.json()) as Orderbook;
  }

  async getVenue(slug: string): Promise<Market["venue"]> {
    if (this.venueCache.has(slug)) {
      return this.venueCache.get(slug)!;
    }
    const market = await this.getMarket(slug);
    return market.venue;
  }
}
