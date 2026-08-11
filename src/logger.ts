import pino from "pino";

// LOG_DEST=stderr keeps stdout clean for protocols that own it (MCP stdio).
const destination = process.env.LOG_DEST === "stderr" ? 2 : 1;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: { colorize: true, destination },
          }
        : undefined,
  },
  process.env.NODE_ENV === "production"
    ? pino.destination(destination)
    : undefined,
);
