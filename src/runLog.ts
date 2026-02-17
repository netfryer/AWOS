/**
 * Run log event schema for JSONL logging.
 */

import type { TaskType, Difficulty, RoutingDecision } from "./types.js";
import type { ExecutionResult } from "./executor/types.js";
import type { ValidationResult } from "./validator.js";

export interface RunAttempt {
  attempt: number;
  modelId: string;
  prompt: string;
  execution: ExecutionResult;
  validation: ValidationResult;
  /** Actual cost in USD when execution.usage is available */
  actualCostUSD?: number;
  /** LLM-as-judge quality score 0-1 when evaluated */
  qualityScore?: number;
}

export interface RunLogEvent {
  runId: string;
  ts: string;
  taskId: string;
  taskType: TaskType;
  difficulty: Difficulty;
  routing: RoutingDecision;
  expectedCostUSD: number | null;
  /** Actual cost in USD from last attempt when usage is available */
  actualCostUSD?: number;
  /** Quality score from evaluator when available */
  qualityScore?: number;
  attempts: RunAttempt[];
  final: {
    status: "ok" | "failed" | "no_qualified_models";
    chosenModelId: string | null;
    retryUsed: boolean;
  };
}
