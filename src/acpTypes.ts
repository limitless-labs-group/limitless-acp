export enum AcpJobPhase {
  REQUEST = 0,
  NEGOTIATION = 1,
  TRANSACTION = 2,
  EVALUATION = 3,
  COMPLETED = 4,
  REJECTED = 5,
  EXPIRED = 6,
}

export enum MemoType {
  MESSAGE = 0,
  CONTEXT_URL = 1,
  IMAGE_URL = 2,
  VOICE_URL = 3,
  OBJECT_URL = 4,
  TXHASH = 5,
  PAYABLE_REQUEST = 6,
  PAYABLE_TRANSFER = 7,
  PAYABLE_FEE = 8,
  PAYABLE_FEE_REQUEST = 9,
}

export interface AcpMemoData {
  id: number;
  memoType: MemoType;
  content: string;
  nextPhase: AcpJobPhase;
  expiry?: string | null;
  createdAt?: string;
  type?: string;
}

export interface AcpJobEventData {
  id: number;
  phase: AcpJobPhase;
  clientAddress: string;
  providerAddress: string;
  evaluatorAddress: string;
  price: number;
  memos: AcpMemoData[];
  context: Record<string, unknown>;
  createdAt?: string;
  memoToSign?: number;
}

export enum SocketEvent {
  ROOM_JOINED = "roomJoined",
  ON_NEW_TASK = "onNewTask",
  ON_EVALUATE = "onEvaluate",
}

export interface JobContext {
  jobId: number;
  clientAddress: string;
  providerAddress: string;
  price: number;
}

export interface ExecuteJobResult {
  deliverable: string | { type: string; value: unknown };
  payableDetail?: { amount: number; tokenAddress: string };
}

export type ValidationResult = boolean | { valid: boolean; reason?: string };

export interface OfferingHandlers {
  executeJob: (
    request: Record<string, unknown>,
    context: JobContext,
  ) => Promise<ExecuteJobResult>;
  validateRequirements?: (
    request: Record<string, unknown>,
  ) => ValidationResult | Promise<ValidationResult>;
  requestPayment?: (
    request: Record<string, unknown>,
  ) => string | Promise<string>;
  requestAdditionalFunds?: (
    request: Record<string, unknown>,
  ) => OfferingFundsRequest | Promise<OfferingFundsRequest>;
}

export interface OfferingFundsRequest {
  content?: string;
  amount: number;
  tokenAddress: string;
  recipient: string;
}

export interface OfferingConfig {
  name: string;
  description: string;
  jobFee: number;
  jobFeeType: "fixed" | "percentage";
  requiredFunds: boolean;
}
