/**
 * Pricing utilities: compute expected cost from registry pricing and detect mismatches.
 * Used to ensure predictedCostUSD does not silently diverge from registry pricing.
 */

export interface EstimatedTokens {
  input: number;
  output: number;
}

export interface PricingSpec {
  inPer1k: number;
  outPer1k: number;
}

/**
 * Computes expected cost in USD from model pricing, estimated tokens, and optional cost multiplier.
 * Formula: (input/1000)*inPer1k + (output/1000)*outPer1k, then * (costMultiplier ?? 1).
 */
export function computePricingExpectedCostUSD(
  pricing: PricingSpec,
  estimatedTokens: EstimatedTokens,
  costMultiplier?: number
): number {
  const raw =
    (estimatedTokens.input / 1000) * pricing.inPer1k +
    (estimatedTokens.output / 1000) * pricing.outPer1k;
  return raw * (costMultiplier ?? 1);
}

/** Default threshold: ratio outside [1/2, 2] is considered a mismatch */
export const PRICING_MISMATCH_THRESHOLD = 2;

export interface PricingMismatchResult {
  mismatch: boolean;
  ratio: number;
}

/**
 * Detects if predictedCostUSD diverges from expected cost by more than the threshold.
 * Mismatch when ratio = predicted/expected is > threshold or < 1/threshold.
 */
export function detectPricingMismatch(
  predictedCostUSD: number,
  expectedCostUSD: number,
  threshold: number = PRICING_MISMATCH_THRESHOLD
): PricingMismatchResult {
  if (expectedCostUSD <= 0) {
    return { mismatch: false, ratio: 1 };
  }
  const ratio = predictedCostUSD / expectedCostUSD;
  const mismatch = ratio > threshold || ratio < 1 / threshold;
  return { mismatch, ratio };
}
