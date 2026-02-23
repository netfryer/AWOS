/**
 * Apply calibration to model expertise.
 */

import type { ModelSpec, TaskType } from "../types.js";
import type { ComputedCalibration } from "./types.js";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Apply calibration to models. Returns new models with expertise replaced by
 * effective expertise (prior blended with calibrated by confidence weight).
 */
export function applyCalibration(
  models: ModelSpec[],
  computed: ComputedCalibration[]
): ModelSpec[] {
  const taskTypes: TaskType[] = ["code", "writing", "analysis", "general"];
  const weightFactor = 0.3;

  return models.map((m) => {
    const newExpertise = { ...m.expertise };
    for (const tt of taskTypes) {
      const prior = m.expertise[tt] ?? 0.5;
      const cal = computed.find((c) => c.modelId === m.id && c.taskType === tt);
      const calibrated = cal?.calibratedExpertise ?? prior;
      const weight = cal ? weightFactor * cal.confidence : 0;
      const effective = clamp(
        prior * (1 - weight) + calibrated * weight,
        0,
        0.99
      );
      newExpertise[tt] = effective;
    }
    return { ...m, expertise: newExpertise };
  });
}
