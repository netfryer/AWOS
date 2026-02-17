/**
 * Scoring service: computeModelScore, getPrior, computeModelScoreWithBreakdown.
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

const COST_THRESHOLDS: Record<"cheap" | "standard" | "premium", number> = {
  cheap: 0.00025,
  standard: 0.0015,
  premium: 0.003,
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
    const expertiseComponent = expertiseVal * 0.4;
    const priorQualityVal = prior?.qualityPrior ?? 0.7;
    const priorQualityComponent = priorQualityVal * 0.6;

    const listCost = estimateListCost(model);
    const costMult = prior?.costMultiplier ?? 1;
    const adjustedCostUSD = listCost * costMult;
    const costPenaltyVal = costPenalty(adjustedCostUSD, ctx.tierProfile);

    let statusPenaltyVal = 0;
    if (status === "deprecated") statusPenaltyVal = 0.1;
    else if (status === "probation") statusPenaltyVal = 0.15;

    const rawScore =
      baseReliability + expertiseComponent + priorQualityComponent - costPenaltyVal - statusPenaltyVal;
    const finalScore = Math.max(0, Math.min(1, rawScore));

    const breakdown: ModelScoreBreakdown = {
      baseReliability,
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
