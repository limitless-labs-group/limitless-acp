import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  parseAbi,
} from "viem";
import { base } from "viem/chains";
import { LimitlessClient } from "../limitless/markets.js";
import { TradingClient } from "../limitless/trading.js";
import { PortfolioClient } from "../limitless/portfolio.js";
import { RedeemClient } from "../limitless/redeem.js";
import { ensureMarketApproved } from "../limitless/approve.js";
import { priceCents } from "../limitless/normalize.js";
import { getWallet } from "../limitless/wallet.js";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

const MAX_BET_USD = Number.parseFloat(
  process.env.LIMITLESS_MCP_MAX_BET_USD || "10",
);

const client = new LimitlessClient();
const tradingClient = new TradingClient(client);
const portfolioClient = new PortfolioClient();

const micro = (v: unknown): number | null =>
  v == null ? null : Number(v) / 1_000_000;

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

export function registerTradingTools(server: McpServer): void {
  server.registerTool(
    "get_wallet",
    {
      title: "Get trading wallet balances",
      description:
        "Show the configured trading wallet's address and its USDC and ETH " +
        "balances on Base. USDC funds bets; ETH pays gas for approvals and " +
        "redemptions.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const { account } = getWallet();
        const pc = createPublicClient({
          chain: base,
          transport: http(process.env.BASE_RPC_URL),
        });
        const [eth, usdc] = await Promise.all([
          pc.getBalance({ address: account.address }),
          pc.readContract({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [account.address],
          }),
        ]);
        return jsonResult({
          address: account.address,
          usdc: Number(formatUnits(usdc, 6)),
          eth: Number(formatEther(eth)),
          maxBetUsd: MAX_BET_USD,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_positions",
    {
      title: "Get open positions",
      description:
        "List the trading wallet's live prediction-market positions on " +
        "Limitless with cost, fill price, current market value, and " +
        "unrealized PnL (all in USDC).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const raw = await portfolioClient.getPositions();
        const clob = (raw.clob ?? []) as unknown as Record<string, unknown>[];
        const positions = clob.map((p) => {
          const market = (p.market ?? {}) as Record<string, unknown>;
          const sides = (p.positions ?? {}) as Record<
            string,
            Record<string, unknown>
          >;
          const mapSide = (s?: Record<string, unknown>) =>
            s
              ? {
                  cost: micro(s.cost),
                  fillPrice: micro(s.fillPrice),
                  marketValue: micro(s.marketValue),
                  unrealizedPnl: micro(s.unrealizedPnl),
                }
              : null;
          return {
            marketId: market.slug ?? null,
            question: market.title ?? null,
            status: market.status ?? null,
            yes: mapSide(sides.yes),
            no: mapSide(sides.no),
          };
        });
        return jsonResult({ positions, count: positions.length });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "place_bet",
    {
      title: "Place a bet",
      description:
        "Place a YES/NO bet on a Limitless prediction market using the " +
        "trading wallet's USDC. FOK (default) fills immediately at market or " +
        "cancels; GTC rests at the limit price. Spends real funds — confirm " +
        "market, side, and amount with the user before calling.",
      inputSchema: {
        marketSlug: z.string().describe("Market slug from search results"),
        side: z.enum(["YES", "NO"]).describe("Outcome to buy"),
        amountUsd: z
          .number()
          .positive()
          .describe(`USDC to spend (max ${MAX_BET_USD})`),
        orderType: z
          .enum(["FOK", "GTC"])
          .optional()
          .describe("Order type (default FOK)"),
        limitPriceCents: z
          .number()
          .int()
          .min(1)
          .max(99)
          .optional()
          .describe("Max price per share in cents (default: current market)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ marketSlug, side, amountUsd, orderType, limitPriceCents }) => {
      try {
        if (amountUsd > MAX_BET_USD) {
          return errorResult(
            new Error(
              `amountUsd ${amountUsd} exceeds the configured cap of ` +
                `${MAX_BET_USD} (LIMITLESS_MCP_MAX_BET_USD)`,
            ),
          );
        }

        const market = await client.getMarket(marketSlug);
        if (market.status !== "FUNDED") {
          return errorResult(
            new Error(`Market is not open (status: ${market.status})`),
          );
        }

        let priceLimit = limitPriceCents;
        if (!priceLimit) {
          const sideIndex = side === "YES" ? 0 : 1;
          priceLimit = Math.ceil(priceCents(market.prices[sideIndex]));
          if (priceLimit < 1) priceLimit = 1;
          if (priceLimit > 99) priceLimit = 99;
        }

        await ensureMarketApproved(marketSlug);

        const result = await tradingClient.createOrder({
          marketSlug,
          side,
          limitPriceCents: priceLimit,
          usdAmount: amountUsd,
          orderType: orderType ?? "FOK",
        });

        return jsonResult({
          status: result.id ? "submitted" : (result.status ?? "unknown"),
          orderId: result.id ?? null,
          marketId: marketSlug,
          question: market.title,
          side,
          usdAmount: amountUsd,
          limitPrice: priceLimit / 100,
          orderType: orderType ?? "FOK",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel a resting order",
      description: "Cancel an open (GTC) order by its order id.",
      inputSchema: {
        orderId: z.string().describe("Order id returned by place_bet"),
      },
    },
    async ({ orderId }) => {
      try {
        await tradingClient.cancelOrder(orderId);
        return jsonResult({ status: "cancelled", orderId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "redeem_winnings",
    {
      title: "Redeem resolved winnings",
      description:
        "Scan for resolved winning positions and redeem them on-chain for " +
        "USDC (spends a small amount of ETH gas). Pass marketSlug to redeem " +
        "one market, omit to redeem everything claimable.",
      inputSchema: {
        marketSlug: z
          .string()
          .optional()
          .describe("Specific market to redeem (default: all claimable)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ marketSlug }) => {
      try {
        const redeemClient = new RedeemClient();
        if (marketSlug) {
          const result = await redeemClient.redeemSingle(marketSlug);
          return jsonResult({
            redeemed: [{ marketId: marketSlug, ...result }],
          });
        }
        const claimable = await redeemClient.scanRedeemable();
        if (claimable.length === 0) {
          return jsonResult({ redeemed: [], message: "Nothing to redeem" });
        }
        const results = await redeemClient.redeemAll();
        return jsonResult({ redeemed: results });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
