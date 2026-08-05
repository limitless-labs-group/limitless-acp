#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import AcpNodeDefault, {
  AcpContractClientV2,
  AcpJobPhases,
  baseAcpConfigV2,
} from "@virtuals-protocol/acp-node";
import type { Address } from "viem";

type AcpClientCtor = new (options: {
  acpContractClient: Awaited<ReturnType<typeof AcpContractClientV2.build>>;
  onNewTask?: () => void;
  onEvaluate?: () => void;
}) => {
  // Minimal memo shape needed for acceptRequirement.
  // (SDK expects memo id + metadata, not just content.)
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  init: (skipSocketConnection?: boolean) => Promise<void>;
  getAgent: (walletAddress: Address) => Promise<{
    name: string;
    jobOfferings: {
      name: string;
      price: number;
      initiateJob: (
        serviceRequirement: object | string,
        evaluatorAddress?: Address,
        expiredAt?: Date,
        preferredSubscriptionTier?: string,
      ) => Promise<number>;
    }[];
  } | null>;
  getJobById: (jobId: number) => Promise<{
    id: number;
    phase: AcpJobPhases;
    rejectionReason?: string;
    payAndAcceptRequirement: (reason?: string) => Promise<unknown>;
    respond: (accept: boolean, reason?: string) => Promise<unknown>;
    getDeliverable: () => unknown;
    memos?: { id: number; content?: string }[];
    latestMemo?: { id: number; content?: string };
  } | null>;
  getTokenBalances: () => Promise<{ tokens: Record<string, unknown> } | undefined>;
};

const AcpClient = (
  (AcpNodeDefault as { default?: unknown }).default ?? AcpNodeDefault
) as AcpClientCtor;

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function normalizePk(raw: string): `0x${string}` {
  const val = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(val)) {
    throw new Error("REQUESTOR_WHITELISTED_WALLET_PRIVATE_KEY is not valid hex");
  }
  return val as `0x${string}`;
}

function buildRequirement(offeringName: string): Record<string, unknown> {
  const requirementFromJson = process.env.SMOKE_REQUIREMENT_JSON?.trim();
  if (requirementFromJson) {
    return JSON.parse(requirementFromJson) as Record<string, unknown>;
  }

  if (offeringName === "browse_markets") {
    const query = process.env.SMOKE_QUERY?.trim() || "BTC";
    const limit = Number.parseInt(process.env.SMOKE_LIMIT || "5", 10);
    return { query, limit };
  }

  if (offeringName === "get_portfolio") {
    const includeHistory = process.env.SMOKE_INCLUDE_HISTORY === "true";
    return { includeHistory };
  }

  if (offeringName === "redeem_winnings") {
    const marketSlug = process.env.SMOKE_MARKET_SLUG?.trim();
    return marketSlug ? { marketSlug } : {};
  }

  if (offeringName === "place_bet") {
    const marketSlug = process.env.SMOKE_MARKET_SLUG?.trim();
    if (!marketSlug) {
      throw new Error(
        "place_bet requires SMOKE_MARKET_SLUG (or SMOKE_REQUIREMENT_JSON).",
      );
    }
    const side = (process.env.SMOKE_SIDE?.trim() || "YES") as "YES" | "NO";
    const amount = Number.parseFloat(process.env.SMOKE_AMOUNT || "0.1");
    const orderType = (process.env.SMOKE_ORDER_TYPE?.trim() || "FOK") as
      | "FOK"
      | "GTC";
    const limitPriceCents = process.env.SMOKE_LIMIT_PRICE_CENTS
      ? Number.parseInt(process.env.SMOKE_LIMIT_PRICE_CENTS, 10)
      : undefined;
    return {
      marketSlug,
      side,
      amount,
      orderType,
      ...(limitPriceCents ? { limitPriceCents } : {}),
    };
  }

  return {};
}

async function retry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number; label: string; quiet?: boolean },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= opts.attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isLast = i === opts.attempts;
      if (isLast) break;
      // Retry only transient AA/paymaster failures.
      if (!/Failed to send user operation|execution reverted|RPC Request failed/i.test(msg)) {
        throw err;
      }
      if (!opts.quiet) {
        console.warn(
          `[SMOKE] ${opts.label} transient failure (${i}/${opts.attempts}): ${msg}. Retrying...`,
        );
      }
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }
  throw lastErr;
}

async function main() {
  const requestorPk = normalizePk(
    requireEnv("REQUESTOR_WHITELISTED_WALLET_PRIVATE_KEY"),
  );
  const requestorEntityId = parseInt(requireEnv("REQUESTOR_ENTITY_ID"), 10);
  const requestorAgentWallet = requireEnv(
    "REQUESTOR_AGENT_WALLET_ADDRESS",
  ) as Address;
  const providerAgentWallet = requireEnv(
    "TARGET_PROVIDER_AGENT_WALLET_ADDRESS",
  ) as Address;
  const offeringName = process.env.SMOKE_OFFERING_NAME?.trim() || "browse_markets";
  const compact = process.env.SMOKE_COMPACT === "true";
  const startedAt = Date.now();

  if (Number.isNaN(requestorEntityId)) {
    throw new Error("REQUESTOR_ENTITY_ID must be a valid number");
  }
  if (requestorAgentWallet.toLowerCase() === providerAgentWallet.toLowerCase()) {
    throw new Error(
      "REQUESTOR_AGENT_WALLET_ADDRESS must differ from TARGET_PROVIDER_AGENT_WALLET_ADDRESS.",
    );
  }

  const acpClient = new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      requestorPk,
      requestorEntityId,
      requestorAgentWallet,
      baseAcpConfigV2,
    ),
  });

  await acpClient.init();
  const balances = await acpClient.getTokenBalances().catch(() => undefined);
  if (balances?.tokens && !compact) {
    console.log("Requestor token balances:", balances.tokens);
  }

  const provider = await acpClient.getAgent(providerAgentWallet);
  if (!provider) {
    throw new Error(
      `Provider not found for wallet ${providerAgentWallet}. Check TARGET_PROVIDER_AGENT_WALLET_ADDRESS.`,
    );
  }

  const offering = provider.jobOfferings.find((o) => o.name === offeringName);
  if (!offering) {
    throw new Error(
      `Offering '${offeringName}' not found on provider. Available: ${provider.jobOfferings
        .map((o) => o.name)
        .join(", ")}`,
    );
  }

  const requirement = buildRequirement(offeringName);
  const jobId = await offering.initiateJob(requirement);

  if (!compact) {
    console.log(`Created job ${jobId} for offering '${offeringName}'`);
  }

  let paid = false;
  const phasesSeen: string[] = [];
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const job = await acpClient.getJobById(jobId);
    if (!job) {
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }

    const phaseName = AcpJobPhases[job.phase];
    phasesSeen.push(phaseName);
    if (!compact) {
      console.log(`Job ${job.id} phase: ${phaseName}`);
    }

    if (job.phase === AcpJobPhases.NEGOTIATION && !paid) {
      try {
        await retry(
          () => job.payAndAcceptRequirement("Buyer smoke test payment"),
          {
            attempts: 4,
            delayMs: 2500,
            label: "payAndAcceptRequirement",
            quiet: compact,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("No notification memo found")) {
          await retry(
            () => job.respond(true, "Buyer smoke test accepted requirement"),
            {
              attempts: 4,
              delayMs: 2500,
              label: "respond(accept)",
              quiet: compact,
            },
          );
        } else {
          throw err;
        }
      }
      paid = true;
      if (!compact) {
        console.log(`Accepted negotiation requirement for job ${job.id}`);
      }
    }

    if (
      job.phase === AcpJobPhases.COMPLETED ||
      job.phase === AcpJobPhases.REJECTED ||
      job.phase === AcpJobPhases.EXPIRED
    ) {
      console.log("Final phase reached:", phaseName);
      if (job.phase === AcpJobPhases.REJECTED && job.rejectionReason) {
        console.log("Rejection reason:", job.rejectionReason);
      }
      const deliverable = job.getDeliverable();
      if (compact) {
        let detail = "";
        try {
          if (typeof deliverable === "string" && deliverable) {
            const parsed = JSON.parse(deliverable) as Record<string, unknown>;
            if (Array.isArray(parsed.markets)) {
              detail = ` markets=${parsed.markets.length}`;
            } else if (Array.isArray(parsed.positions)) {
              detail = ` positions=${parsed.positions.length}`;
            } else if (Array.isArray(parsed.redeemed)) {
              detail = ` redeemed=${parsed.redeemed.length}`;
            }
          }
        } catch {
          /* best-effort compact parsing */
        }
        const uniquePhases = [...new Set(phasesSeen)].join(">");
        const elapsedMs = Date.now() - startedAt;
        console.log(
          `[SMOKE] offering=${offeringName} job=${job.id} status=${phaseName} phases=${uniquePhases} elapsedMs=${elapsedMs}${detail}`,
        );
        return;
      }
      if (deliverable) {
        console.log("Deliverable:", JSON.stringify(deliverable, null, 2));
      } else if (job.latestMemo?.content) {
        console.log("Latest memo content:", job.latestMemo.content);
      }
      return;
    }

    await new Promise((r) => setTimeout(r, 2_000));
  }

  throw new Error("Timed out waiting for job completion");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
