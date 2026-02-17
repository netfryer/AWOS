/**
 * Model HR Canary types.
 */

import type { TaskType } from "../../../types.js";

export type Difficulty = "low" | "medium" | "high";

export type EvaluationMethod = "json_schema" | "contains" | "pass_through";

export interface CanaryTask {
  id: string;
  name: string;
  taskType: TaskType;
  difficulty: Difficulty;
  prompt: string;
  expectedJsonSchema?: Record<string, unknown>;
  evaluationMethod: EvaluationMethod;
}

export interface CanaryRunResult {
  modelId: string;
  taskId: string;
  pass: boolean;
  qualityScore: number;
  defects: string[];
  latencyMs?: number;
  costUSD?: number;
  tsISO: string;
}

export interface CanarySuiteResult {
  suiteId: string;
  modelId: string;
  results: CanaryRunResult[];
  pass: boolean;
  avgQuality: number;
  failedCount: number;
}
