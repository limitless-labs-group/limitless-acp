import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../logger.js";
import fetch from "cross-fetch";
import dotenv from "dotenv";

dotenv.config();

const CTF_ADDRESS =
  "0xC9c98965297Bc527861c898329Ee280632B76e18" as `0x${string}`;
const USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const API_BASE = "https://api.limitless.exchange";

const CTF_ABI = parseAbi([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export interface ClaimablePosition {
  marketSlug: string;
  marketTitle: string;
  conditionId: `0x${string}`;
  winningOutcomeIndex: number;
  side: "YES" | "NO";
  balance: bigint;
  expectedPayout: string;
}

export class RedeemClient {
  private publicClient;
  private walletClient;
  private account;

  constructor() {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    if (!privateKey) throw new Error("PRIVATE_KEY not set");

    this.account = privateKeyToAccount(privateKey);
    this.publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(),
    });
  }

  getAddress(): string {
    return this.account.address;
  }

  async scanRedeemable(): Promise<ClaimablePosition[]> {
    const apiKey = process.env.LIMITLESS_API_KEY;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    };

    const res = await fetch(`${API_BASE}/portfolio/positions`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch positions: ${res.status}`);
    const raw = await res.json();

    const positions: Record<string, unknown>[] = Array.isArray(raw)
      ? raw
      : [
          ...((raw as Record<string, unknown[]>).clob ?? []),
          ...((raw as Record<string, unknown[]>).amm ?? []),
          ...((raw as Record<string, unknown[]>).group ?? []),
        ];

    const claimable: ClaimablePosition[] = [];

    for (const pos of positions) {
      const market = pos.market as Record<string, unknown> | undefined;
      if (!market) continue;

      const slug = market.slug as string;
      const title = market.title as string;
      const status = market.status as string;
      const conditionId = market.conditionId as `0x${string}` | undefined;

      if (status !== "RESOLVED" || !conditionId) continue;

      const denominator = await this.publicClient.readContract({
        address: CTF_ADDRESS,
        abi: CTF_ABI,
        functionName: "payoutDenominator",
        args: [conditionId],
      });

      if (denominator === 0n) continue;

      const positionIds = (market.positionIds ??
        (market as Record<string, unknown>).tokens) as
        | string[]
        | Record<string, string>
        | undefined;
      if (!positionIds) continue;

      const ids = Array.isArray(positionIds)
        ? positionIds
        : [positionIds.yes, positionIds.no];

      for (let i = 0; i < ids.length; i++) {
        const balance = await this.publicClient.readContract({
          address: CTF_ADDRESS,
          abi: CTF_ABI,
          functionName: "balanceOf",
          args: [this.account.address, BigInt(ids[i])],
        });

        if (balance === 0n) continue;

        const numerator = await this.publicClient.readContract({
          address: CTF_ADDRESS,
          abi: CTF_ABI,
          functionName: "payoutNumerators",
          args: [conditionId, BigInt(i)],
        });

        if (numerator === 0n) continue;

        const payout = (balance * numerator) / denominator;

        claimable.push({
          marketSlug: slug,
          marketTitle: title,
          conditionId,
          winningOutcomeIndex: i,
          side: i === 0 ? "YES" : "NO",
          balance,
          expectedPayout: formatUnits(payout, 6),
        });
      }
    }

    return claimable;
  }

  async redeemSingle(
    marketSlug: string,
  ): Promise<{ txHash: string; payout: string }> {
    const claimable = await this.scanRedeemable();
    const position = claimable.find((p) => p.marketSlug === marketSlug);

    if (!position) {
      throw new Error(
        `No redeemable position found for market: ${marketSlug}`,
      );
    }

    const usdcBefore = await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    });

    const indexSets = [
      BigInt(1 << position.winningOutcomeIndex),
    ];

    const hash = await this.walletClient.writeContract({
      address: CTF_ADDRESS,
      abi: CTF_ABI,
      functionName: "redeemPositions",
      args: [USDC_ADDRESS, PARENT_COLLECTION_ID, position.conditionId, indexSets],
    });

    logger.info({ hash, market: marketSlug }, "Redeem tx sent");
    await this.publicClient.waitForTransactionReceipt({ hash });

    const usdcAfter = await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    });

    const actualPayout = formatUnits(usdcAfter - usdcBefore, 6);
    logger.info({ market: marketSlug, payout: actualPayout }, "Redeemed");

    return { txHash: hash, payout: actualPayout };
  }

  async redeemAll(): Promise<
    { marketSlug: string; txHash: string; payout: string }[]
  > {
    const claimable = await this.scanRedeemable();
    const results: { marketSlug: string; txHash: string; payout: string }[] =
      [];

    for (const position of claimable) {
      try {
        const result = await this.redeemSingle(position.marketSlug);
        results.push({ marketSlug: position.marketSlug, ...result });
      } catch (err) {
        logger.error(
          { market: position.marketSlug, error: err },
          "Failed to redeem",
        );
      }
    }

    return results;
  }
}
