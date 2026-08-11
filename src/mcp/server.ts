import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LimitlessClient } from "../limitless/markets.js";
import { priceDecimal, tsMillis } from "../limitless/normalize.js";
import { registerTradingTools } from "./trading.js";
import type { Market } from "../limitless/types.js";

const client = new LimitlessClient();

function marketSummary(m: Market) {
  return {
    marketId: m.slug,
    question: m.title,
    isOpen: m.status === "FUNDED",
    outcomes: (m.prices ?? []).map((price, i) => ({
      name: i === 0 ? "YES" : "NO",
      odds: priceDecimal(price),
    })),
    closesAt: m.expirationTimestamp
      ? new Date(tsMillis(m.expirationTimestamp)).toISOString()
      : null,
    volume: m.volumeFormatted ?? m.volume,
    liquidity: m.liquidityFormatted ?? m.liquidity,
    tradeType: m.tradeType,
  };
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export interface McpServerOptions {
  /** Expose trading tools (place_bet, positions, redeem). Off by default. */
  trading?: boolean;
}

export function tradingEnabledByEnv(): boolean {
  return process.env.LIMITLESS_MCP_TRADING === "true";
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "limitless-markets",
    version: "0.2.0",
  });

  server.registerTool(
    "search_markets",
    {
      title: "Search prediction markets",
      description:
        "Search Limitless Exchange prediction markets by keyword (e.g. 'BTC', " +
        "'election', 'ETH above'). Returns market questions, YES/NO odds as " +
        "decimals (0-1), volume, liquidity, and close times.",
      inputSchema: {
        query: z.string().describe("Search keyword"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max results (default 10)"),
      },
    },
    async ({ query, limit }) => {
      try {
        const markets = await client.searchMarkets(query, {
          limit: limit ?? 10,
        });
        return jsonResult({ markets: markets.map(marketSummary) });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_active_markets",
    {
      title: "List active prediction markets",
      description:
        "List currently active (tradeable) Limitless prediction markets, " +
        "most popular first. Useful when the user wants trending markets " +
        "rather than a keyword search.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max results (default 10)"),
        tradeType: z
          .enum(["amm", "clob", "group"])
          .optional()
          .describe("Filter by market type"),
      },
    },
    async ({ limit, tradeType }) => {
      try {
        const markets = await client.getActiveMarkets({
          limit: limit ?? 10,
          tradeType,
        });
        return jsonResult({ markets: markets.map(marketSummary) });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_market",
    {
      title: "Get market details",
      description:
        "Fetch full details for one Limitless prediction market by its slug " +
        "(the marketId from search results): question, YES/NO odds, executable " +
        "buy/sell prices, status, volume, liquidity, and close time.",
      inputSchema: {
        slug: z.string().describe("Market slug / marketId"),
      },
    },
    async ({ slug }) => {
      try {
        const m = await client.getMarket(slug);
        const tradePrices = (
          m as unknown as { tradePrices?: Record<string, unknown> }
        ).tradePrices;
        return jsonResult({
          ...marketSummary(m),
          description: (m as { description?: string }).description ?? null,
          status: m.status,
          tradePrices: tradePrices ?? null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_orderbook",
    {
      title: "Get market orderbook",
      description:
        "Fetch the live CLOB orderbook (bids, asks, midpoint) for a Limitless " +
        "prediction market by slug. Prices are per YES share.",
      inputSchema: {
        slug: z.string().describe("Market slug / marketId"),
      },
    },
    async ({ slug }) => {
      try {
        const orderbook = await client.getOrderbook(slug);
        return jsonResult(orderbook);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  if (options.trading) {
    registerTradingTools(server);
  }

  return server;
}
