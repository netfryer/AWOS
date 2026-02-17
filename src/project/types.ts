/**
 * Project-level types for hierarchical execution.
 */

import type { TaskType, Difficulty } from "../types.js";
import type { RunLogEvent } from "../runLog.js";

export interface TaskConstraints {
  minQuality?: number;
  maxCostUSD?: number;
}

export interface ProjectRequest {
  directive: string;
  taskType: TaskType;
  difficulty: Difficulty;
  profile: string;
  projectBudgetUSD: number;
  constraints?: TaskConstraints;
}

export type RecommendedTier = "cheap" | "standard" | "premium";

export interface ProjectSubtask {
  id: string;
  title: string;
  description: string;
  taskType: TaskType;
  difficulty: Difficulty;
  importance: number;
  recommendedTier?: RecommendedTier;
  allocatedBudgetUSD: number;
}

export interface SubtaskForecast {
  selectedModelId: string;
  estimatedCostUSD: number;
  predictedQuality: number;
}

export interface SubtaskActual {
  actualCostUSD?: number;
  actualQuality?: number;
}

export interface SubtaskVariance {
  costDeltaUSD?: number;
  costDeltaPct?: number;
  qualityDelta?: number;
  qualityDeltaPct?: number;
}

export interface ProjectResult {
  runId: string;
  subtasks: {
    subtask: ProjectSubtask;
    result: RunLogEvent;
    forecast?: SubtaskForecast;
    actual?: SubtaskActual;
    variance?: SubtaskVariance;
  }[];
  totalActualCostUSD: number;
  finalOutput: string;
  status: "ok" | "budget_exceeded" | "failed";
}

export interface SubtaskEstimate {
  id: string;
  title: string;
  importance: number;
  recommendedTier: RecommendedTier;
  allocatedBudgetUSD: number;
  selectedModelId: string;
  estimatedCostUSD: number;
  predictedQuality: number;
  predictedROI: number;
  estimatedCostRawUSD?: number;
  predictedQualityRaw?: number;
  calibrationApplied?: {
    costMultiplier?: number;
    qualityBias?: number;
    nCost: number;
    nQuality: number;
  };
}

export interface ProjectEstimate {
  status: "ok" | "no_models" | "underfunded";
  totalEstimatedCostUSD: number;
  predictedAverageQuality: number;
  predictedROI: number;
  subtasks: SubtaskEstimate[];
}
