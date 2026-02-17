/**
 * Canary policy: evaluates suite results and recommends status changes.
 * Thresholds come from model governance when present; otherwise defaults apply.
 */

import type { CanarySuiteResult } from "./types.js";
import type { CanaryThresholds } from "../types.js";

export interface CanaryPolicyResult {
  action: "none" | "probation" | "active";
  reason: string;
  details?: Record<string, unknown>;
}

const DEFAULT_PROBATION_QUALITY = 0.7;
const DEFAULT_GRADUATE_QUALITY = 0.82;
const DEFAULT_PROBATION_FAIL_COUNT = 2;

/**
 * Default rules (overridable via governance.canaryThresholds):
 * - failedCount >= probationFailCount OR avgQuality < probationQuality => probation
 * - avgQuality >= graduateQuality AND failedCount == 0 => active
 * - otherwise => none
 */
export function evaluateSuiteForStatusChange(
  _modelId: string,
  suiteResult: CanarySuiteResult,
  governance?: { canaryThresholds?: CanaryThresholds } | null
): CanaryPolicyResult {
  const { failedCount, avgQuality } = suiteResult;
  const thresholds = governance?.canaryThresholds;
  const probationQuality = thresholds?.probationQuality ?? DEFAULT_PROBATION_QUALITY;
  const graduateQuality = thresholds?.graduateQuality ?? DEFAULT_GRADUATE_QUALITY;
  const probationFailCount = thresholds?.probationFailCount ?? DEFAULT_PROBATION_FAIL_COUNT;

  if (failedCount >= probationFailCount || avgQuality < probationQuality) {
    return {
      action: "probation",
      reason: "canary_regression",
      details: { failedCount, avgQuality },
    };
  }

  if (avgQuality >= graduateQuality && failedCount === 0) {
    return {
      action: "active",
      reason: "canary_graduate",
      details: { avgQuality, failedCount },
    };
  }

  return {
    action: "none",
    reason: "no_change",
    details: { failedCount, avgQuality },
  };
}
