import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { logger } from "../logger.js";

export function getWallet() {
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

  const client = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  logger.info({ address: account.address }, "Limitless trading wallet ready");

  return { client, account };
}
