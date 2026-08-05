import {
  Client,
  type ILogger,
  type OrderClient,
} from "@limitless-exchange/sdk";
import { logger } from "../logger.js";

// Adapts the SDK's (message, meta) logger contract to pino's (obj, msg).
const sdkLogger: ILogger = {
  debug: (message, meta) => logger.debug(meta ?? {}, message),
  info: (message, meta) => logger.info(meta ?? {}, message),
  warn: (message, meta) => logger.warn(meta ?? {}, message),
  error: (message, error, meta) =>
    logger.error({ err: error, ...meta }, message),
};

let clientInstance: Client | undefined;
let orderClientInstance: OrderClient | undefined;

/**
 * Shared Limitless SDK client. Authenticated endpoints (orders, portfolio)
 * require HMAC scoped-token credentials (LIMITLESS_HMAC_TOKEN_ID/SECRET);
 * legacy LIMITLESS_API_KEY is kept as a fallback but is deprecated by
 * Limitless and no longer issued.
 */
export function getSdkClient(): Client {
  if (clientInstance) return clientInstance;

  const tokenId = process.env.LIMITLESS_HMAC_TOKEN_ID?.trim();
  const secret = process.env.LIMITLESS_HMAC_SECRET?.trim();
  const apiKey = process.env.LIMITLESS_API_KEY?.trim();
  const baseURL = process.env.LIMITLESS_API_URL?.trim();

  if (!tokenId || !secret) {
    logger.warn(
      "LIMITLESS_HMAC_TOKEN_ID/LIMITLESS_HMAC_SECRET not set — authenticated " +
        "Limitless endpoints (orders, portfolio) will fail. " +
        "Derive credentials with: npm run derive-token",
    );
  }

  clientInstance = new Client({
    ...(baseURL ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(tokenId && secret ? { hmacCredentials: { tokenId, secret } } : {}),
    logger: sdkLogger,
  });
  return clientInstance;
}

/**
 * Shared EIP-712 order client signing with the Limitless trading EOA
 * (PRIVATE_KEY). Reuses the shared transport and market/venue cache, so
 * markets fetched via getSdkClient().markets warm the venue cache for orders.
 */
export function getOrderClient(): OrderClient {
  if (orderClientInstance) return orderClientInstance;

  let privateKey = process.env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required for Limitless order signing");
  }
  if (!privateKey.startsWith("0x")) {
    privateKey = `0x${privateKey}`;
  }

  orderClientInstance = getSdkClient().newOrderClient(privateKey);
  return orderClientInstance;
}
