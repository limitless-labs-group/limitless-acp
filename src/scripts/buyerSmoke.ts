#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import {
  AcpAgent,
  PrivyAlchemyEvmProviderAdapter,
} from "@virtuals-protocol/acp-node-v2";
import type { JobRoomEntry, JobSession } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
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
      if (
        !/user operation|execution reverted|RPC Request failed|timeout/i.test(
          msg,
        )
      ) {
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

type Outcome = {
  status: "completed" | "rejected" | "expired";
  reason?: string;
};

async function main() {
  const requestorAgentWallet = requireEnv("REQUESTOR_AGENT_WALLET_ADDRESS");
  const walletId = requireEnv("REQUESTOR_WALLET_ID");
  const signerPrivateKey = requireEnv("REQUESTOR_SIGNER_PRIVATE_KEY");
  const providerAgentWallet = requireEnv(
    "TARGET_PROVIDER_AGENT_WALLET_ADDRESS",
  );
  const offeringName =
    process.env.SMOKE_OFFERING_NAME?.trim() || "browse_markets";
  const compact = process.env.SMOKE_COMPACT === "true";
  const startedAt = Date.now();

  if (
    requestorAgentWallet.toLowerCase() === providerAgentWallet.toLowerCase()
  ) {
    throw new Error(
      "REQUESTOR_AGENT_WALLET_ADDRESS must differ from TARGET_PROVIDER_AGENT_WALLET_ADDRESS.",
    );
  }

  const chainId = base.id;

  const agent = await AcpAgent.create({
    evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: requestorAgentWallet as `0x${string}`,
      walletId,
      signerPrivateKey,
      chains: [base],
    }),
  });

  let jobIdStr: string | undefined;
  let deliverable: string | undefined;
  let outcome: Outcome | undefined;
  let funded = false;
  let completedEvaluation = false;

  agent.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (!jobIdStr || session.jobId !== jobIdStr) return;
    if (!session.roles.includes("client")) return;
    if (entry.kind !== "system") return;

    try {
      switch (entry.event.type) {
        case "budget.set": {
          if (funded) break;
          funded = true;
          const fundRequest = entry.event.fundRequest;
          if (!compact) {
            console.log(
              `Budget set for job ${session.jobId}: ${entry.event.amount} USDC` +
                (fundRequest
                  ? ` (+ fund request ${fundRequest.amount} -> ${fundRequest.recipient})`
                  : ""),
            );
          }
          await retry(() => session.fund(), {
            attempts: 4,
            delayMs: 2500,
            label: "fund",
            quiet: compact,
          });
          if (!compact) console.log(`Funded job ${session.jobId}`);
          break;
        }
        case "job.submitted": {
          deliverable = entry.event.deliverable;
          if (!compact)
            console.log(`Deliverable received for job ${session.jobId}`);
          // Self-evaluation mode: buyer approves its own job.
          if (!completedEvaluation) {
            completedEvaluation = true;
            await retry(
              () => session.complete("Deliverable accepted (smoke)"),
              {
                attempts: 4,
                delayMs: 2500,
                label: "complete",
                quiet: compact,
              },
            );
          }
          break;
        }
        case "job.completed":
          outcome = { status: "completed" };
          break;
        case "job.rejected":
          outcome = { status: "rejected", reason: entry.event.reason };
          break;
        case "job.expired":
          outcome = { status: "expired" };
          break;
      }
    } catch (err) {
      console.error(`[SMOKE] entry handler error:`, err);
    }
  });

  await agent.start(() => {
    if (!compact) console.log("Buyer agent connected (ACP v2)");
  });

  const requirement = buildRequirement(offeringName);
  const jobId = await agent.createJobByOfferingName(
    chainId,
    offeringName,
    providerAgentWallet,
    requirement,
    { evaluatorAddress: requestorAgentWallet },
  );
  jobIdStr = jobId.toString();

  if (!compact) {
    console.log(`Created job ${jobIdStr} for offering '${offeringName}'`);
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !outcome) {
    await new Promise((r) => setTimeout(r, 2_000));
  }

  await agent.stop().catch(() => undefined);

  if (!outcome) {
    throw new Error("Timed out waiting for job completion");
  }

  if (compact) {
    let detail = "";
    try {
      if (deliverable) {
        const parsed = JSON.parse(deliverable) as Record<string, unknown>;
        if (Array.isArray(parsed.markets))
          detail = ` markets=${parsed.markets.length}`;
        else if (Array.isArray(parsed.positions))
          detail = ` positions=${parsed.positions.length}`;
        else if (Array.isArray(parsed.redeemed))
          detail = ` redeemed=${parsed.redeemed.length}`;
      }
    } catch {
      /* best-effort compact parsing */
    }
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[SMOKE] offering=${offeringName} job=${jobIdStr} status=${outcome.status} elapsedMs=${elapsedMs}${detail}`,
    );
  } else {
    console.log("Final status:", outcome.status);
    if (outcome.reason) console.log("Reason:", outcome.reason);
    if (deliverable) {
      try {
        console.log(
          "Deliverable:",
          JSON.stringify(JSON.parse(deliverable), null, 2),
        );
      } catch {
        console.log("Deliverable:", deliverable);
      }
    }
  }

  process.exit(outcome.status === "completed" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
