#!/usr/bin/env npx tsx
import dotenv from "dotenv";
dotenv.config();

import { connectAcpSocket } from "./acpSocket.js";
import {
  acceptOrRejectJob,
  requestPayment,
  deliverJob,
  getMyAgentInfo,
} from "./acpApi.js";
import { loadOffering, listOfferings } from "./offeringLoader.js";
import {
  AcpJobPhase,
  type AcpJobEventData,
  type JobContext,
  type ExecuteJobResult,
} from "./acpTypes.js";
import {
  checkForExistingProcess,
  writePidToConfig,
  removePidFromConfig,
} from "./acpConfig.js";
import { logger } from "./logger.js";

const ACP_URL = process.env.ACP_SOCKET_URL || "https://acpx.virtuals.io";

function setupCleanupHandlers(): void {
  const cleanup = () => {
    removePidFromConfig();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
    cleanup();
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection");
    cleanup();
    process.exit(1);
  });
}

function resolveOfferingName(data: AcpJobEventData): string | undefined {
  try {
    const negotiationMemo = data.memos.find(
      (m) => m.nextPhase === AcpJobPhase.NEGOTIATION,
    );
    if (negotiationMemo) {
      const parsed = JSON.parse(negotiationMemo.content);
      return parsed.name || parsed.serviceName;
    }
  } catch {
    return undefined;
  }
}

function resolveServiceRequirements(
  data: AcpJobEventData,
): Record<string, unknown> {
  const negotiationMemo = data.memos.find(
    (m) => m.nextPhase === AcpJobPhase.NEGOTIATION,
  );
  if (negotiationMemo) {
    try {
      const parsed = JSON.parse(negotiationMemo.content);
      return parsed.requirement ?? parsed.serviceRequirement ?? {};
    } catch {
      return {};
    }
  }
  return {};
}

async function handleNewTask(data: AcpJobEventData): Promise<void> {
  const jobId = data.id;

  logger.info(
    {
      jobId,
      phase: AcpJobPhase[data.phase] ?? data.phase,
      client: data.clientAddress,
      price: data.price,
    },
    "New task received",
  );

  // REQUEST phase: validate, accept/reject, request payment
  if (data.phase === AcpJobPhase.REQUEST) {
    if (!data.memoToSign) return;

    const negotiationMemo = data.memos.find(
      (m) => m.id === Number(data.memoToSign),
    );
    if (negotiationMemo?.nextPhase !== AcpJobPhase.NEGOTIATION) return;

    const offeringName = resolveOfferingName(data);
    const requirements = resolveServiceRequirements(data);

    if (!offeringName) {
      await acceptOrRejectJob(jobId, {
        accept: false,
        reason: "Invalid offering name",
      });
      return;
    }

    try {
      const { config, handlers } = await loadOffering(offeringName);

      if (handlers.validateRequirements) {
        const validationResult =
          await handlers.validateRequirements(requirements);

        let isValid: boolean;
        let reason: string | undefined;

        if (typeof validationResult === "boolean") {
          isValid = validationResult;
          reason = isValid ? undefined : "Validation failed";
        } else {
          isValid = validationResult.valid;
          reason = validationResult.reason;
        }

        if (!isValid) {
          logger.info(
            { jobId, offering: offeringName, reason },
            "Validation failed — rejecting",
          );
          await acceptOrRejectJob(jobId, {
            accept: false,
            reason: reason || "Validation failed",
          });
          return;
        }
      }

      await acceptOrRejectJob(jobId, {
        accept: true,
        reason: "Job accepted",
      });

      const funds =
        config.requiredFunds && handlers.requestAdditionalFunds
          ? await handlers.requestAdditionalFunds(requirements)
          : undefined;

      const paymentReason = handlers.requestPayment
        ? await handlers.requestPayment(requirements)
        : (funds?.content ?? "Request accepted");

      await requestPayment(jobId, {
        content: paymentReason,
        payableDetail: funds
          ? {
              amount: funds.amount,
              tokenAddress: funds.tokenAddress,
              recipient: funds.recipient,
            }
          : undefined,
      });
    } catch (err) {
      logger.error({ jobId, err }, "Error processing REQUEST phase");
    }
  }

  // TRANSACTION phase: execute offering and deliver result
  if (data.phase === AcpJobPhase.TRANSACTION) {
    const offeringName = resolveOfferingName(data);
    const requirements = resolveServiceRequirements(data);

    if (!offeringName) {
      logger.warn({ jobId }, "TRANSACTION phase but no offering resolved");
      return;
    }

    try {
      const { handlers } = await loadOffering(offeringName);

      const context: JobContext = {
        jobId: data.id,
        clientAddress: data.clientAddress,
        providerAddress: data.providerAddress,
        price: data.price,
      };

      logger.info(
        { jobId, offering: offeringName },
        "Executing offering (TRANSACTION)",
      );
      const result: ExecuteJobResult = await handlers.executeJob(
        requirements,
        context,
      );

      await deliverJob(jobId, {
        deliverable: result.deliverable,
        payableDetail: result.payableDetail,
      });
      logger.info({ jobId }, "Job delivered");
    } catch (err) {
      logger.error({ jobId, err }, "Error delivering job");
    }
  }
}

async function main() {
  checkForExistingProcess();
  writePidToConfig(process.pid);
  setupCleanupHandlers();

  let walletAddress: string;
  try {
    const agentData = await getMyAgentInfo();
    walletAddress = agentData.walletAddress;
    logger.info(
      { name: agentData.name, wallet: walletAddress },
      "Agent info loaded",
    );
  } catch (err) {
    logger.fatal({ err }, "Failed to resolve agent info");
    process.exit(1);
  }

  const offerings = listOfferings();
  logger.info(
    { offerings: offerings.length > 0 ? offerings : "(none)" },
    "Available offerings",
  );

  connectAcpSocket({
    acpUrl: ACP_URL,
    walletAddress,
    callbacks: {
      onNewTask: (data) => {
        handleNewTask(data).catch((err) =>
          logger.error({ err }, "Unhandled error in handleNewTask"),
        );
      },
      onEvaluate: (data) => {
        logger.info(
          { jobId: data.id },
          "onEvaluate received — no action needed",
        );
      },
    },
  });

  logger.info("Seller runtime is running. Waiting for jobs...");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
