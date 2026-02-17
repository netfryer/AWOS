/**
 * Deterministic Model Portfolio Optimizer.
 * Recommends a minimal portfolio of models for key roles to maximize quality per dollar.
 * No LLM calls. Uses trust, variance calibration, and provider diversity.
 */

// ─── src/lib/governance/portfolioOptimizer.ts ─────────────────────────────────

import { trustWeightedScore } from "./trustTracker.js";
import type { ModelSpec, TaskType } from "../../types.js";

export type PortfolioSlots = {
  workerCheap: string;
  workerImplementation: string;
  workerStrategy: string;
  qaPrimary: string;
  qaBackup: string;
};

export type PortfolioRecommendation = {
  portfolio: PortfolioSlots;
  constraints: {
    trustFloors: { worker: number; qa: number };
    minPredictedQuality: number;
  };
  scores: Record<
    string,
    {
      role: "worker" | "qa";
      slot: string;
      predictedQuality: number;
      predictedCost: number;
      ratio: number;
    }
  >;
  rationale: string[];
};

export interface RecommendPortfolioArgs {
  modelRegistry: ModelSpec[];
  trustTracker: { getTrust(modelId: string, role?: "worker" | "qa"): number };
  varianceStatsTracker?: {
    getCalibration(
      modelId: string,
      taskType: string
    ): Promise<{
      nCost: number;
      costMultiplier: number | null;
      nQuality: number;
      qualityBias: number | null;
    }>;
  };
  trustFloors?: { worker: number; qa: number };
  minPredictedQuality?: number;
}

const DEFAULT_TRUST_FLOORS = { worker: 0.5, qa: 0.55 };
const DEFAULT_MIN_PREDICTED_QUALITY = 0.72;
const WORKER_CHEAP_QUALITY_FLOOR_RELAX = 0.05;
const VARIANCE_SAMPLE_THRESHOLD = 5;

/** Token baselines per slot (input, output) for cost estimation */
const SLOT_TOKEN_BASELINES: Record<
  keyof PortfolioSlots,
  { taskType: TaskType; input: number; output: number }
> = {
  workerCheap: { taskType: "general", input: 2000, output: 1000 },
  workerImplementation: { taskType: "code", input: 2500, output: 1500 },
  workerStrategy: { taskType: "analysis", input: 3000, output: 2000 },
  qaPrimary: { taskType: "general", input: 2500, output: 1500 },
  qaBackup: { taskType: "general", input: 2500, output: 1500 },
};

function getProvider(modelId: string): string {
  if (modelId.startsWith("gpt-")) return "openai";
  if (modelId.startsWith("claude-")) return "anthropic";
  return "other";
}

function computeCostUSD(
  model: ModelSpec,
  input: number,
  output: number,
  costMultiplier: number | null
): number {
  const raw =
    (input / 1000) * model.pricing.inPer1k + (output / 1000) * model.pricing.outPer1k;
  return costMultiplier != null ? raw * costMultiplier : raw;
}

function getBaseReliability(model: ModelSpec, taskType: TaskType): number {
  const exp = model.expertise?.[taskType] ?? model.expertise?.general;
  return exp ?? model.reliability ?? 0.7;
}

export async function recommendPortfolio(
  args: RecommendPortfolioArgs
): Promise<PortfolioRecommendation> {
  const {
    modelRegistry,
    trustTracker,
    varianceStatsTracker,
    trustFloors = DEFAULT_TRUST_FLOORS,
    minPredictedQuality = DEFAULT_MIN_PREDICTED_QUALITY,
  } = args;

  const rationale: string[] = [];
  const scores: PortfolioRecommendation["scores"] = {};

  const selectForSlot = async (
    slot: keyof PortfolioSlots,
    role: "worker" | "qa",
    qualityFloor: number,
    preferProvider?: string | null,
    excludeModelIds: string[] = []
  ): Promise<string> => {
    const { taskType, input, output } = SLOT_TOKEN_BASELINES[slot];
    const trustFloor = role === "worker" ? trustFloors.worker : trustFloors.qa;

    const candidates: Array<{
      model: ModelSpec;
      predictedQuality: number;
      predictedCost: number;
      ratio: number;
      provider: string;
    }> = [];

    for (const model of modelRegistry) {
      if (excludeModelIds.includes(model.id)) continue;

      const trust = trustTracker.getTrust(model.id, role);
      if (trust < trustFloor) continue;

      const base = getBaseReliability(model, taskType);
      let quality = trustWeightedScore(base, trust);

      if (varianceStatsTracker) {
        try {
          const cal = await varianceStatsTracker.getCalibration(model.id, taskType);
          if (cal.nQuality >= VARIANCE_SAMPLE_THRESHOLD && cal.qualityBias != null) {
            quality = Math.max(0, Math.min(1, quality + cal.qualityBias));
          }
        } catch {
          /* ignore */
        }
      }

      if (quality < qualityFloor) continue;

      let cost = computeCostUSD(model, input, output, null);
      if (varianceStatsTracker) {
        try {
          const cal = await varianceStatsTracker.getCalibration(model.id, taskType);
          if (cal.nCost >= VARIANCE_SAMPLE_THRESHOLD && cal.costMultiplier != null) {
            cost = computeCostUSD(model, input, output, cal.costMultiplier);
          }
        } catch {
          /* ignore */
        }
      }

      const ratio = quality / Math.max(0.0001, cost);
      candidates.push({
        model,
        predictedQuality: quality,
        predictedCost: cost,
        ratio,
        provider: getProvider(model.id),
      });
    }

    if (candidates.length === 0) {
      const fallback = modelRegistry.find((m) => !excludeModelIds.includes(m.id));
      if (fallback) {
        rationale.push(`No qualified models for ${slot}; using fallback ${fallback.id}`);
        return fallback.id;
      }
      return modelRegistry[0]?.id ?? "";
    }

    candidates.sort((a, b) => {
      if (preferProvider != null) {
        const aMatch = a.provider === preferProvider ? 1 : 0;
        const bMatch = b.provider === preferProvider ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
      }
      return b.ratio - a.ratio;
    });

    const chosen = candidates[0];
    const scoreKey = `${slot}:${chosen.model.id}`;
    scores[scoreKey] = {
      role,
      slot,
      predictedQuality: chosen.predictedQuality,
      predictedCost: chosen.predictedCost,
      ratio: chosen.ratio,
    };
    return chosen.model.id;
  };

  const workerCheapFloor = minPredictedQuality - WORKER_CHEAP_QUALITY_FLOOR_RELAX;

  const workerCheap = await selectForSlot(
    "workerCheap",
    "worker",
    workerCheapFloor
  );
  const workerImpl = await selectForSlot("workerImplementation", "worker", minPredictedQuality);
  const workerImplProvider = getProvider(workerImpl);
  const workerStrategy = await selectForSlot(
    "workerStrategy",
    "worker",
    minPredictedQuality,
    workerImplProvider === "openai" ? "anthropic" : workerImplProvider === "anthropic" ? "openai" : null
  );

  const qaPrimary = await selectForSlot("qaPrimary", "qa", minPredictedQuality);
  const qaBackup = await selectForSlot(
    "qaBackup",
    "qa",
    minPredictedQuality,
    null,
    qaPrimary ? [qaPrimary] : []
  );

  const portfolio: PortfolioSlots = {
    workerCheap,
    workerImplementation: workerImpl,
    workerStrategy,
    qaPrimary,
    qaBackup: qaBackup || qaPrimary,
  };

  rationale.push(
    `workerCheap: ${workerCheap} (quality floor ${workerCheapFloor.toFixed(2)})`,
    `workerImplementation: ${workerImpl}`,
    `workerStrategy: ${workerStrategy} (provider diversity from workerImplementation)`,
    `qaPrimary: ${qaPrimary}`,
    `qaBackup: ${portfolio.qaBackup}${portfolio.qaBackup !== qaPrimary ? " (distinct from primary)" : ""}`
  );

  return {
    portfolio,
    constraints: {
      trustFloors,
      minPredictedQuality,
    },
    scores,
    rationale,
  };
}
