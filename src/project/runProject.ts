/**
 * Hierarchical project execution with budget allocation.
 */

import { randomUUID } from "crypto";
import { runTask } from "../runTask.js";
import { route } from "../router.js";
import { createExecutor } from "../executor/index.js";
import { mockExecutor } from "../executor/mockExecutor.js";
import { DEMO_CONFIG } from "../demoModels.js";
import { getModelRegistryForRuntime } from "../lib/model-hr/index.js";
import { getAllComputed } from "../calibration/store.js";
import { applyCalibration } from "../calibration/apply.js";
import { getModelStatsTracker } from "../modelStats.js";
import { getEvalSampleRateProd } from "../evalConfig.js";
import { getVarianceStatsTracker } from "../varianceStats.js";
import { decomposeDirective } from "./decomposer.js";
import type {
  ProjectRequest,
  ProjectResult,
  ProjectSubtask,
  RecommendedTier,
  SubtaskForecast,
  SubtaskActual,
  SubtaskVariance,
} from "./types.js";
import type { TaskCard, RouterConfig, ModelSpec } from "../types.js";
import type { Executor } from "../executor/types.js";

const CHEAPEST_MODEL_ID = "gpt-4o-mini";
const PREMIUM_MODEL_IDS = new Set(["gpt-4o", "claude-sonnet-4-5-20250929"]);

function filterModelsByTier(models: ModelSpec[], tier?: RecommendedTier): ModelSpec[] {
  if (!tier || tier === "cheap") return models;
  if (tier === "standard") {
    return models.filter((m) => m.id !== CHEAPEST_MODEL_ID);
  }
  if (tier === "premium") {
    return models.filter((m) => PREMIUM_MODEL_IDS.has(m.id));
  }
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

function getCostFromEvent(event: { actualCostUSD?: number; expectedCostUSD: number | null }): number {
  if (event.actualCostUSD != null) return event.actualCostUSD;
  return event.expectedCostUSD ?? 0;
}

function computePredictedQuality(
  modelId: string,
  taskType: string,
  statsByModelId: Map<string, { evaluatedRuns: number; avgQualityScore: number }>,
  modelExpertise: number
): number {
  const stats = statsByModelId.get(modelId);
  let predictedQuality: number;
  if (stats && stats.evaluatedRuns >= 5) {
    predictedQuality = stats.avgQualityScore;
  } else if (stats && stats.evaluatedRuns > 0) {
    predictedQuality = 0.7 * modelExpertise + 0.3 * stats.avgQualityScore;
  } else {
    predictedQuality = modelExpertise;
  }
  return Math.max(0, Math.min(1, predictedQuality));
}

export async function runProject(request: ProjectRequest): Promise<ProjectResult> {
  const runId = randomUUID();
  const {
    directive,
    taskType: _requestTaskType,
    difficulty: _requestDifficulty,
    profile,
    projectBudgetUSD,
    constraints,
  } = request;
  const { models: modelRegistry } = await getModelRegistryForRuntime();
  const computed = await getAllComputed();
  const calibratedRegistry = applyCalibration(modelRegistry, computed);

  const profileOverrides = getProfileConfigOverrides(profile);
  const config: Partial<RouterConfig> = {
    ...DEMO_CONFIG,
    ...profileOverrides,
    thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
    evaluationSampleRate: getEvalSampleRateProd(),
  };

  const decomposed = await decomposeDirective(directive);
  const totalImportance = decomposed.reduce((sum, d) => sum + d.importance, 0) || 1;

  const statsList = await getModelStatsTracker().getStats();
  const statsByModelId = new Map(
    statsList.map((s) => [s.modelId, { evaluatedRuns: s.evaluatedRuns, avgQualityScore: s.avgQualityScore }])
  );

  const subtaskResults: ProjectResult["subtasks"] = [];
  let totalActualCostUSD = 0;
  let status: ProjectResult["status"] = "ok";

  for (let i = 0; i < decomposed.length; i++) {
    const d = decomposed[i];
    const allocatedBudgetUSD =
      projectBudgetUSD * (d.importance / totalImportance);

    const subtask: ProjectSubtask = {
      id: `subtask-${runId.slice(0, 8)}-${i + 1}`,
      title: d.title,
      description: d.description,
      taskType: d.taskType,
      difficulty: d.difficulty,
      importance: d.importance,
      recommendedTier: d.recommendedTier,
      allocatedBudgetUSD,
    };

    const task: TaskCard = {
      id: subtask.id,
      taskType: subtask.taskType,
      difficulty: subtask.difficulty,
      constraints: {
        ...constraints,
        maxCostUSD: allocatedBudgetUSD,
      },
    };

    const filteredModels = filterModelsByTier(calibratedRegistry, d.recommendedTier);
    const routing = route(task, filteredModels, config, subtask.description);
    const executor: Executor =
      routing.chosenModelId != null
        ? {
            async execute(req) {
              return createExecutor(req.modelId).execute(req);
            },
          }
        : mockExecutor;

    const result = await runTask({
      task,
      models: filteredModels,
      config,
      executor,
      logPath: "./runs/runs.jsonl",
      directive: subtask.description,
    });

    const cost = getCostFromEvent(result);
    totalActualCostUSD += cost;

    const finalModelId = result.final.chosenModelId;
    const lastAttempt = result.attempts[result.attempts.length - 1];
    const actualCostUSD = result.actualCostUSD ?? lastAttempt?.actualCostUSD;
    const actualQuality = result.qualityScore ?? lastAttempt?.qualityScore;

    let forecast: SubtaskForecast | undefined;
    let actual: SubtaskActual | undefined;
    let variance: SubtaskVariance | undefined;

    if (finalModelId != null) {
      const model = filteredModels.find((m) => m.id === finalModelId);
      const estimatedCostUSD =
        routing.expectedCostUSD ??
        (model
          ? (routing.estimatedTokens.input / 1000) * model.pricing.inPer1k +
            (routing.estimatedTokens.output / 1000) * model.pricing.outPer1k
          : 0);
      const expertise = model?.expertise[subtask.taskType] ?? 0;
      const predictedQuality = computePredictedQuality(
        finalModelId,
        subtask.taskType,
        statsByModelId,
        expertise
      );

      forecast = {
        selectedModelId: finalModelId,
        estimatedCostUSD,
        predictedQuality,
      };

      if (actualCostUSD != null || actualQuality != null) {
        actual = {
          ...(actualCostUSD != null ? { actualCostUSD } : {}),
          ...(actualQuality != null ? { actualQuality } : {}),
        };
      }

      if (actual && (actual.actualCostUSD != null || actual.actualQuality != null)) {
        variance = {};
        if (actual.actualCostUSD != null && estimatedCostUSD > 0) {
          variance.costDeltaUSD = actual.actualCostUSD - estimatedCostUSD;
          variance.costDeltaPct = variance.costDeltaUSD / estimatedCostUSD;
        }
        if (actual.actualQuality != null) {
          variance.qualityDelta = actual.actualQuality - predictedQuality;
          variance.qualityDeltaPct =
            predictedQuality > 0 ? variance.qualityDelta / predictedQuality : undefined;
        }
      }

      getVarianceStatsTracker()
        .recordSubtaskVariance({
          modelId: finalModelId,
          taskType: subtask.taskType,
          estimatedCostUSD,
          actualCostUSD,
          predictedQuality,
          actualQuality,
        })
        .catch((err) => console.warn("VarianceStatsTracker.recordSubtaskVariance failed:", err));
    }

    subtaskResults.push({
      subtask,
      result,
      ...(forecast ? { forecast } : {}),
      ...(actual ? { actual } : {}),
      ...(variance ? { variance } : {}),
    });

    if (totalActualCostUSD > projectBudgetUSD) {
      status = "budget_exceeded";
      break;
    }

    if (result.final.status === "failed" || result.final.status === "no_qualified_models") {
      status = "failed";
      break;
    }
  }

  const finalOutput = subtaskResults
    .map(({ result }) => {
      const lastAttempt = result.attempts[result.attempts.length - 1];
      return lastAttempt?.execution?.outputText ?? "";
    })
    .filter(Boolean)
    .join("\n\n");

  return {
    runId,
    subtasks: subtaskResults,
    totalActualCostUSD,
    finalOutput,
    status,
  };
}
