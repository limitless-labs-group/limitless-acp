#!/usr/bin/env npx tsx
// MCP streamable-HTTP entrypoint (stateless): each POST /mcp request gets a
// fresh server + transport, so any client can connect without session state.
import dotenv from "dotenv";
dotenv.config();

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, tradingEnabledByEnv } from "./server.js";
import { logger } from "../logger.js";

const PORT = Number.parseInt(process.env.MCP_PORT || "3333", 10);
const TRADING = tradingEnabledByEnv();
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN?.trim();

// Money-moving tools must never sit on an open port.
if (TRADING && !AUTH_TOKEN) {
  logger.fatal(
    "LIMITLESS_MCP_TRADING=true requires MCP_AUTH_TOKEN on the HTTP " +
      "transport. Refusing to start.",
  );
  process.exit(1);
}

function authorized(req: http.IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(AUTH_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }

  if (!authorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      }),
    );
    return;
  }

  if (req.method !== "POST") {
    // Stateless mode: no SSE resumption stream, no sessions to delete.
    res
      .writeHead(405, { "Content-Type": "application/json", Allow: "POST" })
      .end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed" },
          id: null,
        }),
      );
    return;
  }

  try {
    const server = createMcpServer({ trading: TRADING });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    logger.error({ err }, "MCP request failed");
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
});

httpServer.listen(PORT, () => {
  logger.info(
    { port: PORT, trading: TRADING, auth: Boolean(AUTH_TOKEN) },
    "Limitless MCP server listening on /mcp",
  );
});
