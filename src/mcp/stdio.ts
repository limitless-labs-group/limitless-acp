#!/usr/bin/env npx tsx
// MCP stdio entrypoint. Stdout belongs to the JSON-RPC protocol, so all
// logging must go to stderr — set before any module loads the logger.
process.env.LOG_DEST = "stderr";

async function main() {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();

  const { StdioServerTransport } =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createMcpServer, tradingEnabledByEnv } = await import("./server.js");

  const server = createMcpServer({ trading: tradingEnabledByEnv() });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
