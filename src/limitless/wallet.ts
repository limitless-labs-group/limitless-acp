import { createWalletClient, http } from "viem";
import type { Chain, HttpTransport, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";
import { logger } from "../logger.js";

export interface TradingWallet {
  client: WalletClient<HttpTransport, Chain, PrivateKeyAccount>;
  account: PrivateKeyAccount;
}

// The inferred client type exceeds what TypeScript will serialize, so the
// return type is annotated explicitly.
export function getWallet(): TradingWallet {
  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    logger.fatal("PRIVATE_KEY is not set in environment variables");
    throw new Error("PRIVATE_KEY is required");
  }

  if (!privateKey.startsWith("0x")) {
    privateKey = `0x${privateKey}`;
  }

  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    logger.fatal(
      "Invalid PRIVATE_KEY format. Must be 0x-prefixed 32-byte hex string.",
    );
    throw new Error("Invalid PRIVATE_KEY format");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  // No publicActions extension: callers that need reads make their own
  // public client, and extending here inflates the inferred type past what
  // TypeScript will serialize.
  const client = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

  logger.info({ address: account.address }, "Limitless trading wallet ready");

  return { client, account };
}
