/**
 * Custom types for the Limitless ACP seller service.
 * ACP protocol types (AcpJobPhases, AcpJob, AcpMemo, etc.) come from
 * @virtuals-protocol/acp-node — these are only the Limitless-specific interfaces.
 */

export interface JobContext {
  jobId: number;
  clientAddress: string;
  providerAddress: string;
  netPayableAmount?: number;
}

export interface ExecuteJobResult {
  deliverable: string;
  returnAmount?: number;
  error?: {
    reason: string;
    refundAmount?: number;
  };
}

export type ValidationResult = boolean | { valid: boolean; reason?: string };

export interface RequiredFunds {
  amount: number;
  reason: string;
}

export interface OfferingHandlers {
  executeJob: (
    request: Record<string, unknown>,
    context: JobContext,
  ) => Promise<ExecuteJobResult>;
  validateRequirements?: (
    request: Record<string, unknown>,
  ) => ValidationResult | Promise<ValidationResult>;
  getRequiredFunds?: (
    request: Record<string, unknown>,
  ) => RequiredFunds | Promise<RequiredFunds>;
}

export interface OfferingConfig {
  name: string;
  description: string;
  requiredFunds: boolean;
}
