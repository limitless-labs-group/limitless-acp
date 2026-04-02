#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import AcpClientDefault, {
  AcpContractClientV2,
  AcpJob,
  AcpJobPhases,
  AcpMemo,
  baseAcpConfigV2,
  FareAmount,
  MemoType,
} from "@virtuals-protocol/acp-node";

// The SDK's CJS type declarations don't expose a constructable default under
// Node16 moduleResolution. The class IS constructable at runtime.
const AcpClient = AcpClientDefault as unknown as new (options: {
  acpContractClient: Awaited<ReturnType<typeof AcpContractClientV2.build>>;
  onNewTask?: (job: AcpJob, memoToSign?: AcpMemo) => void;
  onEvaluate?: (job: AcpJob) => void;
}) => unknown;
import { loadOffering, listOfferings } from "./offeringLoader.js";
import { getWallet } from "./limitless/wallet.js";
import { logger } from "./logger.js";
import type { JobContext } from "./acpTypes.js";

const config = baseAcpConfigV2;

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    logger.fatal(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

async function handleRequest(
  job: AcpJob,
  _memoToSign: AcpMemo,
  limitlessWalletAddress: `0x${string}`,
): Promise<void> {
  const { id: jobId, name: jobName } = job;

  if (!jobName) {
    logger.warn({ jobId }, "No job name — rejecting");
    await job.reject("Invalid offering");
    return;
  }

  try {
    const { config: offeringConfig, handlers } = await loadOffering(jobName);
    const requirements = (job.requirement ?? {}) as Record<string, unknown>;

    if (handlers.validateRequirements) {
      const result = await handlers.validateRequirements(requirements);
      const isValid = typeof result === "boolean" ? result : result.valid;
      const reason =
        typeof result === "boolean"
          ? "Validation failed"
          : (result.reason ?? "Validation failed");

      if (!isValid) {
        logger.info({ jobId, offering: jobName, reason }, "Validation failed — rejecting");
        await job.reject(reason);
        return;
      }
    }

    await job.accept("Job accepted");

    if (offeringConfig.requiredFunds && handlers.getRequiredFunds) {
      const funds = await handlers.getRequiredFunds(requirements);
      await job.createPayableRequirement(
        funds.reason,
        MemoType.PAYABLE_REQUEST,
        new FareAmount(funds.amount, config.baseFare),
        limitlessWalletAddress,
      );
      logger.info(
        { jobId, amount: funds.amount },
        "Payable requirement created — awaiting buyer payment",
      );
    } else {
      await job.createRequirement("Request accepted, proceeding with execution");
    }
  } catch (err) {
    logger.error({ jobId, err }, "Error handling REQUEST phase");
    try {
      await job.reject("Internal error processing request");
    } catch {
      /* best-effort reject */
    }
  }
}

async function handleTransaction(job: AcpJob): Promise<void> {
  const { id: jobId, name: jobName } = job;

  if (!jobName) {
    logger.warn({ jobId }, "TRANSACTION phase but no offering name");
    return;
  }

  try {
    const { handlers } = await loadOffering(jobName);
    const requirements = (job.requirement ?? {}) as Record<string, unknown>;

    const context: JobContext = {
      jobId: job.id,
      clientAddress: job.clientAddress,
      providerAddress: job.providerAddress,
      netPayableAmount: job.netPayableAmount,
    };

    logger.info({ jobId, offering: jobName }, "Executing offering");
    const result = await handlers.executeJob(requirements, context);

    if (result.error) {
      const { reason, refundAmount } = result.error;
      logger.warn({ jobId, reason, refundAmount }, "Offering execution failed");

      if (refundAmount && refundAmount > 0) {
        await job.rejectPayable(
          reason,
          new FareAmount(refundAmount, config.baseFare),
        );
        logger.info({ jobId, refundAmount }, "Job rejected with refund");
      } else {
        await job.reject(reason);
      }
      return;
    }

    const deliverable =
      typeof result.deliverable === "string"
        ? result.deliverable
        : JSON.stringify(result.deliverable);

    if (result.returnAmount && result.returnAmount > 0) {
      await job.deliverPayable(
        deliverable,
        new FareAmount(result.returnAmount, config.baseFare),
      );
    } else {
      await job.deliver(deliverable);
    }

    logger.info({ jobId }, "Job delivered");
  } catch (err) {
    logger.error({ jobId, err }, "Error delivering job");
    try {
      const refundAmount = job.netPayableAmount;
      if (refundAmount && refundAmount > 0) {
        await job.rejectPayable(
          "Internal error executing job. Funds refunded.",
          new FareAmount(refundAmount, config.baseFare),
        );
        logger.info({ jobId, refundAmount }, "Unhandled error — refunded buyer");
      } else {
        await job.reject("Internal error executing job");
      }
    } catch {
      /* best-effort reject/refund */
    }
  }
}

async function main() {
  const walletPrivateKey = requireEnv("WHITELISTED_WALLET_PRIVATE_KEY");
  const agentWalletAddress = requireEnv("SELLER_AGENT_WALLET_ADDRESS");
  const entityId = parseInt(requireEnv("SELLER_ENTITY_ID"), 10);

  if (isNaN(entityId)) {
    logger.fatal("SELLER_ENTITY_ID must be a valid number");
    process.exit(1);
  }

  let limitlessWalletAddress: `0x${string}`;
  try {
    const { account } = getWallet();
    limitlessWalletAddress = account.address;
    logger.info({ address: limitlessWalletAddress }, "Limitless trading wallet ready");
  } catch (err) {
    logger.fatal({ err }, "Failed to initialize Limitless trading wallet");
    process.exit(1);
  }

  const offerings = listOfferings();
  logger.info(
    { offerings: offerings.length > 0 ? offerings : "(none)" },
    "Available offerings",
  );

  new AcpClient({
    acpContractClient: await AcpContractClientV2.build(
      walletPrivateKey as `0x${string}`,
      entityId,
      agentWalletAddress as `0x${string}`,
      config,
    ),
    onNewTask: async (job: AcpJob, memoToSign?: AcpMemo) => {
      const { id: jobId, phase: jobPhase, name: jobName } = job;

      if (!memoToSign) {
        if (
          jobPhase === AcpJobPhases.COMPLETED ||
          jobPhase === AcpJobPhases.REJECTED
        ) {
          logger.info(
            { jobId, phase: AcpJobPhases[jobPhase] },
            "Job reached terminal state",
          );
        }
        return;
      }

      logger.info(
        { jobId, phase: AcpJobPhases[jobPhase], jobName, memoId: memoToSign.id },
        "Job event received",
      );

      try {
        if (jobPhase === AcpJobPhases.REQUEST) {
          await handleRequest(job, memoToSign, limitlessWalletAddress);
        } else if (jobPhase === AcpJobPhases.TRANSACTION) {
          await handleTransaction(job);
        }
      } catch (err) {
        logger.error({ jobId, err }, "Unhandled error in job handler");
      }
    },
  });

  logger.info("Seller runtime is running. Waiting for jobs...");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
