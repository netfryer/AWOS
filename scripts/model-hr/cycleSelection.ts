/**
 * Pure selection logic for HR cycle canary candidates.
 * No filesystem or network - suitable for unit testing.
 */

import type { ModelRegistryEntry } from "../../src/lib/model-hr/types.js";

export interface ModelHrSignal {
  modelId: string;
  reason: string;
  tsISO: string;
  newStatus?: string;
}

const SIGNAL_REASONS_PRICING_OR_META = ["pricing_changed", "metadata_changed"];
const ESCALATION_REASONS = [
  "canary_regression",
  "quality_below_threshold",
  "cost_variance_exceeded",
  "auto_disabled_regression",
  "termination_review_started",
];

/**
 * Check if a signal is within the given time window (ms).
 * @param nowTs - current timestamp (for unit testing; pass Date.now() in prod)
 */
function isWithinWindow(tsISO: string, sinceMs: number, nowTs: number): boolean {
  const ts = new Date(tsISO).getTime();
  return nowTs - ts <= sinceMs;
}

/**
 * Pure function: should this model be canaried?
 * - status=probation OR
 * - created within last sinceDays OR
 * - canaryStatus is none/failed OR
 * - pricing_changed/metadata_changed signal exists in last signalDays
 * @param nowTs - current timestamp (for unit testing; pass Date.now() in prod)
 */
export function needsCanary(
  model: ModelRegistryEntry,
  signals: ModelHrSignal[],
  sinceDays: number,
  signalDays: number = 7,
  nowTs: number = Date.now()
): boolean {
  if (model.identity.status === "disabled" || model.identity.status === "deprecated") {
    return false;
  }
  if (model.identity.status === "probation") return true;

  const sinceMs = sinceDays * 24 * 60 * 60 * 1000;
  const signalMs = signalDays * 24 * 60 * 60 * 1000;

  const created = model.createdAtISO ? new Date(model.createdAtISO).getTime() : 0;
  if (nowTs - created < sinceMs) return true;

  const status = model.evaluationMeta?.canaryStatus;
  if (status === undefined || status === "none" || status === "failed") return true;

  const hasRecentPricingOrMetaSignal = signals.some(
    (s) =>
      SIGNAL_REASONS_PRICING_OR_META.includes(s.reason) &&
      isWithinWindow(s.tsISO, signalMs, nowTs)
  );
  if (hasRecentPricingOrMetaSignal) return true;

  return false;
}

/**
 * Count escalation signals in the window (reasons that indicate probation/disable).
 */
export function countEscalations(
  signals: ModelHrSignal[],
  sinceDays: number,
  nowTs: number = Date.now()
): number {
  const sinceMs = sinceDays * 24 * 60 * 60 * 1000;
  return signals.filter(
    (s) => ESCALATION_REASONS.includes(s.reason) && isWithinWindow(s.tsISO, sinceMs, nowTs)
  ).length;
}

/**
 * Check if priors fail cost variance (costMultiplier or varianceBandHigh > maxCostVarianceRatio).
 */
export function priorsFailCostVariance(
  priors: { costMultiplier: number; varianceBandHigh?: number }[],
  maxCostVarianceRatio: number | undefined
): boolean {
  if (maxCostVarianceRatio == null) return false;
  return priors.some(
    (p) =>
      p.costMultiplier > maxCostVarianceRatio ||
      (p.varianceBandHigh != null && p.varianceBandHigh > maxCostVarianceRatio)
  );
}

/**
 * Check if priors meet minQualityPrior and costMultiplier within bounds.
 */
export function priorsMeetPromotionThresholds(
  priors: { qualityPrior: number; costMultiplier: number }[],
  minQualityPrior: number,
  maxCostVarianceRatio: number | undefined
): boolean {
  if (priors.length === 0) return false;
  const maxCost = maxCostVarianceRatio ?? 5;
  return priors.every(
    (p) => p.qualityPrior >= minQualityPrior && p.costMultiplier <= maxCost
  );
}
