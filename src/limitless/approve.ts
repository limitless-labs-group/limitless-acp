import {
  createPublicClient,
  http,
  parseAbi,
  maxUint256,
} from "viem";
import { base } from "viem/chains";
import { getWallet } from "./wallet.js";
import { LimitlessClient } from "./markets.js";
import { logger } from "../logger.js";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const CTF_ADDRESS = "0xC9c98965297Bc527861c898329Ee280632B76e18" as const;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

const CTF_ABI = parseAbi([
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",
]);

const approvedVenues = new Set<string>();

export async function ensureMarketApproved(marketSlug: string): Promise<void> {
  const limitlessClient = new LimitlessClient();
  const market = await limitlessClient.getMarket(marketSlug);

  if (!market.venue?.exchange) {
    throw new Error(`Market ${marketSlug} has no venue/exchange data`);
  }

  const exchangeAddress = market.venue.exchange as `0x${string}`;

  if (approvedVenues.has(exchangeAddress)) {
    return;
  }

  const { client: walletClient, account } = getWallet();
  const publicClient = createPublicClient({ chain: base, transport: http() });

  await approveUsdc(
    publicClient,
    walletClient,
    account.address,
    exchangeAddress,
  );
  await approveCtf(
    publicClient,
    walletClient,
    account.address,
    exchangeAddress,
  );

  if (market.venue.adapter) {
    const adapterAddress = market.venue.adapter as `0x${string}`;
    try {
      await approveCtf(
        publicClient,
        walletClient,
        account.address,
        adapterAddress,
      );
    } catch (e) {
      logger.warn({ error: e }, "Failed to approve CTF for adapter");
    }
  }

  approvedVenues.add(exchangeAddress);
  logger.info({ marketSlug, exchange: exchangeAddress }, "Market approved");
}

async function approveUsdc(
  publicClient: any,
  walletClient: any,
  owner: `0x${string}`,
  spender: `0x${string}`,
) {
  const allowance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
  const minAllowance = 1_000_000_000000n;

  if (allowance < minAllowance) {
    logger.info({ spender }, "Approving USDC...");
    const hash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, maxUint256],
    });
    logger.info({ hash }, "USDC Approval Tx Sent");
    await publicClient.waitForTransactionReceipt({ hash });
    logger.info("USDC Approval Confirmed");
  } else {
    logger.debug({ spender }, "USDC already approved");
  }
}

async function approveCtf(
  publicClient: any,
  walletClient: any,
  owner: `0x${string}`,
  operator: `0x${string}`,
) {
  const isApproved = (await publicClient.readContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "isApprovedForAll",
    args: [owner, operator],
  })) as boolean;

  if (!isApproved) {
    logger.info({ operator }, "Approving CTF...");
    const hash = await walletClient.writeContract({
      address: CTF_ADDRESS,
      abi: CTF_ABI,
      functionName: "setApprovalForAll",
      args: [operator, true],
    });
    logger.info({ hash }, "CTF Approval Tx Sent");
    await publicClient.waitForTransactionReceipt({ hash });
    logger.info("CTF Approval Confirmed");
  } else {
    logger.debug({ operator }, "CTF already approved");
  }
}
