/**
 * Comp (cost computation) service: centralizes predictedCostUSD derivation.
 * Formula: pricing.inPer1k/outPer1k * estimated tokens * costMultiplier (from priors when available).
 * All cost predictions are traceable to inputs.
 */

import type { ModelRegistryEntry, ModelPerformancePrior } from "../types.js";

export interface CompContext {
  taskType: string;
  difficulty: string;
  tierProfile: "cheap" | "standard" | "premium";
}

export interface CompInputsBreakdown {
  inPer1k: number;
  outPer1k: number;
  inputTokens: number;
  outputTokens: number;
  rawCostUSD: number;
  costMultiplierUsed: number;
}

export interface CompResult {
  /** Canonical predicted cost: rawCost * costMultiplier */
  predictedCostUSD: number;
  /** Base cost before multiplier (pricing * tokens) */
  expectedCostUSD: number;
  /** Multiplier from priors or 1 */
  costMultiplierUsed: number;
  /** Traceable inputs for debugging */
  inputsBreakdown: CompInputsBreakdown;
}

const ROUND_DECIMALS = 6;

function roundCost(v: number): number {
  return Math.round(v * 10 ** ROUND_DECIMALS) / 10 ** ROUND_DECIMALS;
}

/**
 * Computes predicted cost in USD for a model entry.
 * Uses: pricing * estimated tokens * costMultiplier (from priors slice when available).
 */
export function computePredictedCostUSD(
  modelEntry: ModelRegistryEntry,
  estimatedTokens: { input: number; output: number },
  ctx: CompContext,
  priors?: ModelPerformancePrior[] | null
): CompResult {
  const { inPer1k, outPer1k } = modelEntry.pricing;
  const { input, output } = estimatedTokens;

  const rawCostUSD =
    (input / 1000) * inPer1k + (output / 1000) * outPer1k;
  const prior = priors?.find(
    (p) => p.taskType === ctx.taskType && p.difficulty === ctx.difficulty
  );
  const costMultiplierUsed = prior?.costMultiplier ?? 1;
  const predictedCostUSD = roundCost(rawCostUSD * costMultiplierUsed);
  const expectedCostUSD = roundCost(rawCostUSD);

  return {
    predictedCostUSD,
    expectedCostUSD,
    costMultiplierUsed,
    inputsBreakdown: {
      inPer1k,
      outPer1k,
      inputTokens: input,
      outputTokens: output,
      rawCostUSD: roundCost(rawCostUSD),
      costMultiplierUsed,
    },
  };
}
