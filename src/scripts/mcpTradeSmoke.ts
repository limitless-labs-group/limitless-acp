#!/usr/bin/env npx tsx
// Full-path Phase 2 smoke: spawns the stdio MCP server with trading enabled
// and places a REAL small bet through the MCP tool surface.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BET_USD = Number.parseFloat(process.env.MCP_SMOKE_BET_USD || "0.5");

function firstText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] })
    .content;
  return content?.find((c) => c.type === "text")?.text ?? "";
}

function isError(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

async function main() {
  const client = new Client({ name: "mcp-trade-smoke", version: "0.0.1" });
  await client.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp/stdio.ts"],
      env: {
        ...(process.env as Record<string, string>),
        LIMITLESS_MCP_TRADING: "true",
        DRY_RUN: "false",
      },
    }),
  );

  const tools = await client.listTools();
  console.log(
    "[TRADE_SMOKE] tools:",
    tools.tools.map((t) => t.name).join(", "),
  );

  const wallet = await client.callTool({ name: "get_wallet", arguments: {} });
  if (isError(wallet)) throw new Error(firstText(wallet));
  const walletInfo = JSON.parse(firstText(wallet));
  console.log(
    `[TRADE_SMOKE] wallet ${walletInfo.address}: ${walletInfo.usdc} USDC, ${walletInfo.eth} ETH`,
  );
  if (walletInfo.usdc < BET_USD) throw new Error("insufficient USDC for smoke");

  const search = await client.callTool({
    name: "search_markets",
    arguments: { query: "BTC", limit: 10 },
  });
  const markets = JSON.parse(firstText(search)).markets as {
    marketId: string;
    question: string;
    isOpen: boolean;
    tradeType: string;
    outcomes: { name: string; odds: number }[];
  }[];
  const target = markets.find(
    (m) =>
      m.isOpen &&
      m.tradeType === "clob" &&
      (m.outcomes[0]?.odds ?? 0) > 0.05 &&
      (m.outcomes[0]?.odds ?? 1) < 0.95,
  );
  if (!target) throw new Error("no suitable open CLOB market found");
  console.log(
    `[TRADE_SMOKE] target: "${target.question}" (${target.marketId}) YES=${target.outcomes[0]?.odds}`,
  );

  const bet = await client.callTool({
    name: "place_bet",
    arguments: {
      marketSlug: target.marketId,
      side: "YES",
      amountUsd: BET_USD,
      orderType: "FOK",
    },
  });
  if (isError(bet)) throw new Error(`place_bet failed: ${firstText(bet)}`);
  const betInfo = JSON.parse(firstText(bet));
  console.log(
    `[TRADE_SMOKE] place_bet: status=${betInfo.status} orderId=${betInfo.orderId} @ ${betInfo.limitPrice}`,
  );

  const positions = await client.callTool({
    name: "get_positions",
    arguments: {},
  });
  const posInfo = JSON.parse(firstText(positions));
  console.log(`[TRADE_SMOKE] positions: ${posInfo.count}`);

  await client.close();
  console.log("[TRADE_SMOKE] OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
