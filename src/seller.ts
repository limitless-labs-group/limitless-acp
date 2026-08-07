#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import {
  AcpAgent,
  AssetToken,
  PrivyAlchemyEvmProviderAdapter,
} from "@virtuals-protocol/acp-node-v2";
import type {
  AgentMessage,
  JobRoomEntry,
  JobSession,
} from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";
import { loadOffering, listOfferings } from "./offeringLoader.js";
import { getWallet } from "./limitless/wallet.js";
import { getSdkClient } from "./limitless/sdk.js";
import { logger } from "./logger.js";
import type { JobContext } from "./acpTypes.js";

const DEFAULT_PRICE_USD = 0.01;

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    logger.fatal(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

function parseRequirement(
  content: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* non-JSON requirement */
  }
  return undefined;
}

function findRequirement(
  session: JobSession,
): Record<string, unknown> | undefined {
  const entry = [...session.entries]
    .reverse()
    .find(
      (e): e is AgentMessage =>
        e.kind === "message" && e.contentType === "requirement",
    );
  return entry ? parseRequirement(entry.content) : undefined;
}

async function handleRequirement(
  session: JobSession,
  entry: AgentMessage,
  limitlessWalletAddress: `0x${string}`,
): Promise<void> {
  const jobId = session.jobId;
  const job = await session.fetchJob();
  const offeringName = job.description;

  if (!offeringName) {
    logger.warn({ jobId }, "Job has no offering name — rejecting");
    await session.reject("Invalid offering");
    return;
  }

  try {
    const { config: offeringConfig, handlers } =
      await loadOffering(offeringName);
    const requirements = parseRequirement(entry.content) ?? {};

    if (handlers.validateRequirements) {
      const result = await handlers.validateRequirements(requirements);
      const isValid = typeof result === "boolean" ? result : result.valid;
      const reason =
        typeof result === "boolean"
          ? "Validation failed"
          : (result.reason ?? "Validation failed");

      if (!isValid) {
        logger.info(
          { jobId, offering: offeringName, reason },
          "Validation failed — rejecting",
        );
        await session.reject(reason);
        return;
      }
    }

    const price = offeringConfig.priceUsd ?? DEFAULT_PRICE_USD;

    if (offeringConfig.requiredFunds && handlers.getRequiredFunds) {
      const funds = await handlers.getRequiredFunds(requirements);
      await session.setBudgetWithFundRequest(
        AssetToken.usdc(price, session.chainId),
        AssetToken.usdc(funds.amount, session.chainId),
        limitlessWalletAddress,
      );
      logger.info(
        { jobId, offering: offeringName, price, fundAmount: funds.amount },
        "Budget set with fund request — awaiting buyer funding",
      );
    } else {
      await session.setBudget(AssetToken.usdc(price, session.chainId));
      logger.info(
        { jobId, offering: offeringName, price },
        "Budget set — awaiting buyer funding",
      );
    }
  } catch (err) {
    logger.error({ jobId, err }, "Error handling job requirement");
    try {
      await session.reject("Internal error processing request");
    } catch {
      /* best-effort reject */
    }
  }
}

async function handleFunded(session: JobSession): Promise<void> {
  const jobId = session.jobId;
  const job = session.job ?? (await session.fetchJob());
  const offeringName = job.description;

  if (!offeringName) {
    logger.warn({ jobId }, "Funded job has no offering name");
    return;
  }

  const { config: offeringConfig, handlers } = await loadOffering(offeringName);

  try {
    const requirements = findRequirement(session) ?? {};

    // Stake routed to the Limitless trading wallet at funding time, if any.
    let netPayableAmount: number | undefined;
    const fundIntent = job.getFundRequestIntent();
    if (fundIntent?.rawAmount != null) {
      netPayableAmount = Number(fundIntent.rawAmount) / 1_000_000;
    }

    const context: JobContext = {
      jobId: Number(session.jobId),
      clientAddress: job.clientAddress,
      providerAddress: job.providerAddress,
      netPayableAmount,
    };

    logger.info({ jobId, offering: offeringName }, "Executing offering");
    const result = await handlers.executeJob(requirements, context);

    if (result.error) {
      const { reason } = result.error;
      logger.warn({ jobId, reason }, "Offering execution failed — rejecting");
      await session.reject(reason);
      if (offeringConfig.requiredFunds) {
        logger.warn(
          { jobId },
          "Funded job rejected — verify buyer stake refund from the trading wallet",
        );
      }
      return;
    }

    const deliverable =
      typeof result.deliverable === "string"
        ? result.deliverable
        : JSON.stringify(result.deliverable);

    await session.submit(deliverable);
    logger.info({ jobId }, "Deliverable submitted");
  } catch (err) {
    logger.error({ jobId, err }, "Error executing funded job");
    try {
      await session.reject("Internal error executing job");
      if (offeringConfig.requiredFunds) {
        logger.warn(
          { jobId },
          "Funded job rejected — verify buyer stake refund from the trading wallet",
        );
      }
    } catch {
      /* best-effort reject */
    }
  }
}

async function main() {
  const agentWalletAddress = requireEnv("SELLER_AGENT_WALLET_ADDRESS");
  const walletId = requireEnv("ACP_WALLET_ID");
  const signerPrivateKey = requireEnv("ACP_SIGNER_PRIVATE_KEY");

  let limitlessWalletAddress: `0x${string}`;
  try {
    const { account } = getWallet();
    limitlessWalletAddress = account.address;
  } catch (err) {
    logger.fatal({ err }, "Failed to initialize Limitless trading wallet");
    process.exit(1);
  }

  // Preflight: place_bet requires the Limitless profile in EOA trading mode
  // and the HMAC token bound to the trading wallet. Logging into the Limitless
  // web UI can silently flip the account back to smart-wallet mode.
  try {
    const profile = (await getSdkClient().portfolio.getProfile()) as {
      account?: string;
      tradeWalletOption?: string;
    };
    if (profile.tradeWalletOption && profile.tradeWalletOption !== "eoa") {
      logger.warn(
        { tradeWalletOption: profile.tradeWalletOption },
        "Limitless profile is NOT in EOA trading mode — orders will be " +
          'rejected. Fix: PUT /profiles with { "tradeWalletOption": "eoa" }',
      );
    }
    if (
      profile.account &&
      profile.account.toLowerCase() !== limitlessWalletAddress.toLowerCase()
    ) {
      logger.warn(
        {
          profileAccount: profile.account,
          tradingWallet: limitlessWalletAddress,
        },
        "HMAC token profile does not match the trading wallet — orders will fail",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Limitless profile preflight check skipped");
  }

  const offerings = listOfferings();
  logger.info(
    { offerings: offerings.length > 0 ? offerings : "(none)" },
    "Available offerings",
  );

  const agent = await AcpAgent.create({
    evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: agentWalletAddress as `0x${string}`,
      walletId,
      signerPrivateKey,
      chains: [base],
    }),
  });

  const handledRequirement = new Set<string>();
  const handledFunded = new Set<string>();

  agent.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (!session.roles.includes("provider")) return;

    try {
      if (entry.kind === "message" && entry.contentType === "requirement") {
        if (session.status !== "open" || handledRequirement.has(session.jobId))
          return;
        handledRequirement.add(session.jobId);
        logger.info(
          { jobId: session.jobId, from: entry.from },
          "Job requirement received",
        );
        await handleRequirement(session, entry, limitlessWalletAddress);
      } else if (entry.kind === "system") {
        const type = entry.event.type;
        if (type === "job.funded") {
          if (handledFunded.has(session.jobId)) return;
          handledFunded.add(session.jobId);
          await handleFunded(session);
        } else if (
          type === "job.completed" ||
          type === "job.rejected" ||
          type === "job.expired"
        ) {
          logger.info(
            { jobId: session.jobId, event: type },
            "Job reached terminal state",
          );
          handledRequirement.delete(session.jobId);
          handledFunded.delete(session.jobId);
        }
      }
    } catch (err) {
      logger.error(
        { jobId: session.jobId, err },
        "Unhandled error in entry handler",
      );
    }
  });

  await agent.start(() => {
    logger.info("Seller runtime is running (ACP v2). Waiting for jobs...");
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
