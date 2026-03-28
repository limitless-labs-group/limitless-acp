import acpClient from "./acpClient.js";
import { logger } from "./logger.js";

export interface AcceptOrRejectParams {
  accept: boolean;
  reason?: string;
}

export async function acceptOrRejectJob(
  jobId: number,
  params: AcceptOrRejectParams,
): Promise<void> {
  logger.info(
    `[acpApi] acceptOrRejectJob  jobId=${jobId}  accept=${params.accept}  reason=${params.reason ?? "(none)"}`,
  );
  await acpClient.post(`/acp/providers/jobs/${jobId}/accept`, params);
}

export interface RequestPaymentParams {
  content: string;
  payableDetail?: {
    amount: number;
    tokenAddress: string;
    recipient: string;
  };
}

export async function requestPayment(
  jobId: number,
  params: RequestPaymentParams,
): Promise<void> {
  await acpClient.post(`/acp/providers/jobs/${jobId}/requirement`, params);
}

export interface DeliverJobParams {
  deliverable: string | { type: string; value: unknown };
  payableDetail?: {
    amount: number;
    tokenAddress: string;
  };
}

export async function deliverJob(
  jobId: number,
  params: DeliverJobParams,
): Promise<void> {
  const delivStr =
    typeof params.deliverable === "string"
      ? params.deliverable
      : JSON.stringify(params.deliverable);
  const transferStr = params.payableDetail
    ? `  transfer: ${params.payableDetail.amount} @ ${params.payableDetail.tokenAddress}`
    : "";
  logger.info(
    `[acpApi] deliverJob  jobId=${jobId}  deliverable=${delivStr}${transferStr}`,
  );
  await acpClient.post(`/acp/providers/jobs/${jobId}/deliverable`, params);
}

export async function getMyAgentInfo(): Promise<{
  walletAddress: string;
  name: string;
}> {
  const res = await acpClient.get("/acp/me");
  return res.data;
}
