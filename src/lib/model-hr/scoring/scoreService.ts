/**
 * Scoring service: computeModelScore, getPrior, computeModelScoreWithBreakdown.
 *
 * Uses normalized weighted scoring (base*0.25 + expertise*0.35 + prior*0.40 = qualityBase ≤ 1)
 * with subtractive cost/status penalties. Enables "top-down expensive, bottom-up cheap":
 * - Premium tier: higher cost threshold (0.02) → expensive models (e.g. gpt-4o) avoid penalty → score by quality.
 * - Cheap tier: low threshold (0.00025) → expensive models get max penalty → cheap models (e.g. gpt-4o-mini) win.
 */

import type {
  ModelPerformancePrior,
  ModelRegistryEntry,
  ModelScoreContext,
  ModelScoreBreakdown,
} from "../types.js";
import type { RegistryService } from "../registry/registryService.js";

const DEFAULT_INPUT_TOKENS = 2000;
const DEFAULT_OUTPUT_TOKENS = 1000;

/** Premium tier allows higher cost (prefer quality); cheap tier penalizes expensive models. */
const COST_THRESHOLDS: Record<"cheap" | "standard" | "premium", number> = {
  cheap: 0.00025,
  standard: 0.0015,
  premium: 0.02,
};

function estimateListCost(model: ModelRegistryEntry): number {
  const { inPer1k, outPer1k } = model.pricing;
  return (
    (DEFAULT_INPUT_TOKENS / 1000) * inPer1k +
    (DEFAULT_OUTPUT_TOKENS / 1000) * outPer1k
  );
}

function costPenalty(
  adjustedCost: number,
  tierProfile: "cheap" | "standard" | "premium"
): number {
  const threshold = COST_THRESHOLDS[tierProfile];
  if (adjustedCost <= threshold) return 0;
  const excess = (adjustedCost - threshold) / threshold;
  return Math.min(0.5, excess * 0.5);
}

export class ScoreService {
  constructor(private registry: RegistryService) {}

  async getPrior(
    model: ModelRegistryEntry,
    taskType: string,
    difficulty: string
  ): Promise<ModelPerformancePrior | null> {
    const priors = await this.registry.getStorage().loadPriors(model.id);
    return (
      priors.find(
        (p) => p.taskType === taskType && p.difficulty === difficulty
      ) ?? null
    );
  }

  async computeModelScore(
    model: ModelRegistryEntry,
    ctx: ModelScoreContext
  ): Promise<number> {
    const { score } = await this.computeModelScoreWithBreakdown(model, ctx);
    return score;
  }

  async computeModelScoreWithBreakdown(
    model: ModelRegistryEntry,
    ctx: ModelScoreContext
  ): Promise<{ score: number; breakdown: ModelScoreBreakdown }> {
    const status = model.identity.status;
    const zeroBreakdown: ModelScoreBreakdown = {
      baseReliability: 0,
      expertiseComponent: 0,
      priorQualityComponent: 0,
      statusPenalty: 0,
      costPenalty: 0,
      adjustedCostUSD: 0,
      finalScore: 0,
    };
    if (status === "disabled") {
      return { score: 0, breakdown: zeroBreakdown };
    }

    const prior = await this.getPrior(model, ctx.taskType, ctx.difficulty);

    const baseReliability = model.reliability ?? 0.7;
    const expertiseVal = model.expertise?.[ctx.taskType] ?? 0.7;
    const priorQualityVal = prior?.qualityPrior ?? 0.7;

    /** Weighted sum: max 1.0 when all components are 1. Enables meaningful differentiation after penalties. */
    const WEIGHTS = { base: 0.25, expertise: 0.35, prior: 0.4 };
    const baseComponent = baseReliability * WEIGHTS.base;
    const expertiseComponent = expertiseVal * WEIGHTS.expertise;
    const priorQualityComponent = priorQualityVal * WEIGHTS.prior;
    const qualityBase = baseComponent + expertiseComponent + priorQualityComponent;

    const listCost = estimateListCost(model);
    const costMult = prior?.costMultiplier ?? 1;
    const adjustedCostUSD = listCost * costMult;
    const costPenaltyVal = costPenalty(adjustedCostUSD, ctx.tierProfile);

    let statusPenaltyVal = 0;
    if (status === "deprecated") statusPenaltyVal = 0.1;
    else if (status === "probation") statusPenaltyVal = 0.15;

    const finalScore = Math.max(0, Math.min(1, qualityBase - costPenaltyVal - statusPenaltyVal));

    const breakdown: ModelScoreBreakdown = {
      baseReliability: baseComponent,
      expertiseComponent,
      priorQualityComponent,
      statusPenalty: statusPenaltyVal,
      costPenalty: costPenaltyVal,
      adjustedCostUSD,
      finalScore,
    };

    return { score: finalScore, breakdown };
  }
}
