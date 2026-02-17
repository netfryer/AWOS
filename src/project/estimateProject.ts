/**
 * Planning / Cost Forecast mode. No LLM calls, no execution.
 */

import { randomUUID } from "crypto";
import { DEMO_CONFIG } from "../demoModels.js";
import { getModelRegistryForRuntime } from "../lib/model-hr/index.js";
import { getModelStatsTracker } from "../modelStats.js";
import { getVarianceStatsTracker } from "../varianceStats.js";
import { estimateTokensForTask } from "../router.js";
import { debugLog } from "../utils/debug.js";
import { deterministicDecomposeDirective } from "./deterministicDecomposer.js";
import type {
  ProjectRequest,
  ProjectEstimate,
  SubtaskEstimate,
  RecommendedTier,
} from "./types.js";
import type { TaskCard, RouterConfig, ModelSpec } from "../types.js";

const CHEAPEST_MODEL_ID = "gpt-4o-mini";
const PREMIUM_MODEL_IDS = new Set(["gpt-4o", "claude-sonnet-4-5-20250929"]);
function filterModelsByTier(models: ModelSpec[], tier?: RecommendedTier): ModelSpec[] {
  if (!tier || tier === "cheap") return models;
  if (tier === "standard") return models.filter((m) => m.id !== CHEAPEST_MODEL_ID);
  if (tier === "premium") return models.filter((m) => PREMIUM_MODEL_IDS.has(m.id));
  return models;
}

function getProfileConfigOverrides(profile: string): Partial<RouterConfig> {
  switch (profile) {
    case "fast":
      return {
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
        fallbackCount: 1,
        onBudgetFail: "best_effort_within_budget",
      };
    case "strict":
      return {
        thresholds: { low: 0.75, medium: 0.85, high: 0.92 },
        fallbackCount: 2,
        onBudgetFail: "best_effort_within_budget",
      };
    case "low_cost":
      return {
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
        fallbackCount: 1,
        onBudgetFail: "fail",
      };
    default:
      return {};
  }
}

function computeEstimatedCostUSD(
  model: ModelSpec,
  estimatedTokens: { input: number; output: number }
): number {
  return (
    (estimatedTokens.input / 1000) * model.pricing.inPer1k +
    (estimatedTokens.output / 1000) * model.pricing.outPer1k
  );
}

export async function estimateProjectWithROI(
  request: ProjectRequest
): Promise<ProjectEstimate> {
  const runId = randomUUID();
  const { profile, projectBudgetUSD, constraints } = request;
  const { models: modelRegistry } = await getModelRegistryForRuntime();

  const profileOverrides = getProfileConfigOverrides(profile);
  const config: RouterConfig = {
    ...DEMO_CONFIG,
    ...profileOverrides,
    thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
  };

  const subtasks = deterministicDecomposeDirective(request.directive);
  const totalImportance = subtasks.reduce((sum, s) => sum + s.importance, 0) || 1;
  debugLog("Decomposition Result", subtasks);

  const statsList = await getModelStatsTracker().getStats();
  const statsByModelId = new Map(statsList.map((s) => [s.modelId, s]));

  const subtaskEstimates: SubtaskEstimate[] = [];
  let totalEstimatedCostUSD = 0;

  for (let i = 0; i < subtasks.length; i++) {
    const s = subtasks[i];
    const allocatedBudgetUSD = projectBudgetUSD * (s.importance / totalImportance);

    const task: TaskCard = {
      id: `est-${runId.slice(0, 8)}-${s.id}`,
      taskType: s.taskType,
      difficulty: s.difficulty,
      constraints: { ...constraints, maxCostUSD: allocatedBudgetUSD },
    };

    const estimatedTokens = estimateTokensForTask(task, s.description, config);
    const filteredModels = filterModelsByTier(modelRegistry, s.recommendedTier);

    let best: {
      modelId: string;
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
    } | null = null;

    for (const model of filteredModels) {
      const estimatedCostRaw = computeEstimatedCostUSD(model, estimatedTokens);

      const stats = statsByModelId.get(model.id);
      const expertise = model.expertise[s.taskType] ?? 0;

      let predictedQualityRaw: number;
      if (stats && stats.evaluatedRuns >= 5) {
        predictedQualityRaw = stats.avgQualityScore;
      } else if (stats && stats.evaluatedRuns > 0) {
        predictedQualityRaw = 0.7 * expertise + 0.3 * stats.avgQualityScore;
      } else {
        predictedQualityRaw = expertise;
      }
      predictedQualityRaw = Math.max(0, Math.min(1, predictedQualityRaw));

      const calibration = await getVarianceStatsTracker().getCalibration(
        model.id,
        s.taskType
      );

      let estimatedCostUSD = estimatedCostRaw;
      if (calibration.costMultiplier != null) {
        estimatedCostUSD = estimatedCostRaw * calibration.costMultiplier;
      }

      if (estimatedCostUSD > allocatedBudgetUSD) continue;

      let predictedQuality = predictedQualityRaw;
      if (calibration.qualityBias != null) {
        predictedQuality = Math.max(
          0,
          Math.min(1, predictedQualityRaw + calibration.qualityBias)
        );
      }

      const predictedROI = estimatedCostUSD > 0 ? predictedQuality / estimatedCostUSD : 0;

      if (!best || predictedROI > best.predictedROI) {
        best = {
          modelId: model.id,
          estimatedCostUSD,
          predictedQuality,
          predictedROI,
          estimatedCostRawUSD: estimatedCostRaw,
          predictedQualityRaw,
          calibrationApplied: {
            ...(calibration.costMultiplier != null
              ? { costMultiplier: calibration.costMultiplier }
              : {}),
            ...(calibration.qualityBias != null
              ? { qualityBias: calibration.qualityBias }
              : {}),
            nCost: calibration.nCost,
            nQuality: calibration.nQuality,
          },
        };
      }
    }

    if (!best) {
      const failStatus =
        filteredModels.length === 0 ? "no_models" : "underfunded";
      debugLog("Estimate Summary", {
        projectBudgetUSD,
        totalEstimatedCostUSD,
        predictedAvgQuality: 0,
        predictedROI: 0,
        status: failStatus,
      });
      return {
        status: failStatus,
        totalEstimatedCostUSD,
        predictedAverageQuality: 0,
        predictedROI: 0,
        subtasks: subtaskEstimates,
      };
    }

    totalEstimatedCostUSD += best.estimatedCostUSD;
    subtaskEstimates.push({
      id: task.id,
      title: s.title,
      importance: s.importance,
      recommendedTier: s.recommendedTier ?? "standard",
      allocatedBudgetUSD,
      selectedModelId: best.modelId,
      estimatedCostUSD: best.estimatedCostUSD,
      predictedQuality: best.predictedQuality,
      predictedROI: best.predictedROI,
      ...(best.estimatedCostRawUSD != null
        ? { estimatedCostRawUSD: best.estimatedCostRawUSD }
        : {}),
      ...(best.predictedQualityRaw != null
        ? { predictedQualityRaw: best.predictedQualityRaw }
        : {}),
      ...(best.calibrationApplied
        ? { calibrationApplied: best.calibrationApplied }
        : {}),
    });
  }

  const predictedAverageQuality =
    subtaskEstimates.length > 0
      ? subtaskEstimates.reduce((s, e) => s + e.predictedQuality, 0) /
        subtaskEstimates.length
      : 0;
  const predictedROI =
    totalEstimatedCostUSD > 0 ? predictedAverageQuality / totalEstimatedCostUSD : 0;

  debugLog("Estimate Summary", {
    projectBudgetUSD,
    totalEstimatedCostUSD,
    predictedAvgQuality: predictedAverageQuality,
    predictedROI,
    status: "ok",
  });

  return {
    status: "ok",
    totalEstimatedCostUSD,
    predictedAverageQuality,
    predictedROI,
    subtasks: subtaskEstimates,
  };
}
