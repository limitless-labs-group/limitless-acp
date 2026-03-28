import fetch from "cross-fetch";
import { logger } from "../logger.js";

const API_BASE =
  process.env.LIMITLESS_API_URL || "https://api.limitless.exchange";

function getHeaders(): Record<string, string> {
  const apiKey = process.env.LIMITLESS_API_KEY;
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
}

export interface Trade {
  id: string;
  marketId: number;
  strategy: string;
  outcome: string;
  tradeAmount: string;
  tradeAmountUSD: string;
  timestamp: string;
}

export interface Position {
  market: {
    title: string;
    slug: string;
  };
  positions: {
    yes?: {
      marketValue: string;
      unrealizedPnl: string;
      fillPrice: string;
    };
    no?: {
      marketValue: string;
      unrealizedPnl: string;
      fillPrice: string;
    };
  };
}

export class PortfolioClient {
  constructor(private baseUrl: string = API_BASE) {}

  async getTrades(): Promise<Trade[]> {
    const url = `${this.baseUrl}/portfolio/trades`;
    logger.debug({ url }, "Fetching user trades");
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch trades: ${res.status}`);
    return (await res.json()) as Trade[];
  }

  async getPositions(): Promise<Position[]> {
    const url = `${this.baseUrl}/portfolio/positions`;
    logger.debug({ url }, "Fetching user positions");
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch positions: ${res.status}`);
    return (await res.json()) as Position[];
  }

  async verifyFill(
    marketSlug: string,
    side: "YES" | "NO",
  ): Promise<{ filled: boolean; balance: bigint }> {
    const url = `${this.baseUrl}/portfolio/positions`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch positions: ${res.status}`);
    const raw = await res.json();

    const positions: Record<string, unknown>[] = Array.isArray(raw)
      ? raw
      : [
          ...((raw as Record<string, unknown[]>).clob ?? []),
          ...((raw as Record<string, unknown[]>).amm ?? []),
          ...((raw as Record<string, unknown[]>).group ?? []),
        ];

    const match = positions.find(
      (p) =>
        (p.market as Record<string, unknown>)?.slug === marketSlug ||
        p.marketSlug === marketSlug,
    );

    if (!match) {
      return { filled: false, balance: 0n };
    }

    const posData = match.positions as Record<string, Record<string, unknown>>;
    const sideData =
      side === "YES"
        ? posData?.yes ??
          (match as Record<string, unknown>).yes ??
          (match as Record<string, unknown>).yesPosition
        : posData?.no ??
          (match as Record<string, unknown>).no ??
          (match as Record<string, unknown>).noPosition;

    if (!sideData) {
      return { filled: false, balance: 0n };
    }

    const rawBalance =
      (sideData as Record<string, unknown>).tokensBalance ??
      (sideData as Record<string, unknown>).balance ??
      (sideData as Record<string, unknown>).size ??
      "0";

    const balance = BigInt(Math.round(Number(rawBalance)));
    return { filled: balance > 0n, balance };
  }
}
