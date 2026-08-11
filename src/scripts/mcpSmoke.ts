#!/usr/bin/env npx tsx
// Spawns the stdio MCP server as a real subprocess and exercises every tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function firstText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] })
    .content;
  return content?.find((c) => c.type === "text")?.text ?? "";
}

async function main() {
  const client = new Client({ name: "mcp-smoke", version: "0.0.1" });
  await client.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp/stdio.ts"],
    }),
  );

  const tools = await client.listTools();
  console.log("[MCP_SMOKE] tools:", tools.tools.map((t) => t.name).join(", "));

  const search = await client.callTool({
    name: "search_markets",
    arguments: { query: "BTC", limit: 3 },
  });
  const markets = JSON.parse(firstText(search)).markets as {
    marketId: string;
    question: string;
    outcomes: { name: string; odds: number }[];
  }[];
  console.log(
    `[MCP_SMOKE] search_markets: ${markets.length} results, first: "${markets[0]?.question}" YES=${markets[0]?.outcomes?.[0]?.odds}`,
  );

  const slug = markets[0]?.marketId;
  if (!slug) throw new Error("search returned no markets");

  const detail = await client.callTool({
    name: "get_market",
    arguments: { slug },
  });
  const parsed = JSON.parse(firstText(detail));
  console.log(
    `[MCP_SMOKE] get_market: status=${parsed.status} closesAt=${parsed.closesAt}`,
  );

  const active = await client.callTool({
    name: "get_active_markets",
    arguments: { limit: 3 },
  });
  console.log(
    `[MCP_SMOKE] get_active_markets: ${JSON.parse(firstText(active)).markets.length} results`,
  );

  const book = await client.callTool({
    name: "get_orderbook",
    arguments: { slug },
  });
  const bookParsed = JSON.parse(firstText(book));
  console.log(
    `[MCP_SMOKE] get_orderbook: bids=${bookParsed.bids?.length ?? 0} asks=${bookParsed.asks?.length ?? 0}`,
  );

  await client.close();
  console.log("[MCP_SMOKE] OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
