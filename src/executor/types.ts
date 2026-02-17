/**
 * Execution abstraction types.
 */

import type { TaskCard } from "../types.js";

export type ExecutionStatus = "ok" | "error";

export interface ExecutionRequest {
  task: TaskCard;
  modelId: string;
  prompt: string;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  outputText: string;
  error?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUSD?: number;
  };
  latencyMs?: number;
}

export interface Executor {
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
}
