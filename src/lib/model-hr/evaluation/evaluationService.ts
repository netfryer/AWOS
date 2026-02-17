/**
 * Evaluation service: observations, priors, probation/active status.
 */

import type {
  ModelObservation,
  ModelPerformancePrior,
  ModelRegistryEntry,
  ModelStatus,
} from "../types.js";
import type { RegistryService } from "../registry/registryService.js";
import { emitModelHrSignal } from "../signals/signalLog.js";
import { enqueueAction } from "../actions/actionsQueue.js";
import { getPriorsSampleSize } from "../config.js";
const PROBATION_QUALITY_THRESHOLD = 0.55;
const PROBATION_SAMPLE_MIN = 30;
const PROBATION_TO_DISABLE_SAMPLE_MIN = 60;
const GRADUATE_QUALITY_THRESHOLD = 0.75;
const GRADUATE_SAMPLE_MIN = 50;
const COST_MULTIPLIER_MIN = 0.25;
const COST_MULTIPLIER_MAX = 5;
/** When defectRate exceeds this, reduce qualityPrior (bounded). */
const DEFECT_RATE_HIGH_THRESHOLD = 0.4;
/** Max reduction to qualityPrior when defectRate is high (e.g. 0.08 = 8% cap). */
const DEFECT_RATE_QUALITY_PENALTY_MAX = 0.08;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export class EvaluationService {
  constructor(private registry: RegistryService) {}

  async recordObservation(obs: ModelObservation): Promise<void> {
    const storage = this.registry.getStorage();
    await storage.appendObservation(obs);
  }

  async updatePriors(
    modelId: string,
    taskType: string,
    difficulty: string
  ): Promise<ModelPerformancePrior | null> {
    const storage = this.registry.getStorage();
    const observations = await storage.loadObservations(modelId, getPriorsSampleSize());
    const slice = observations.filter(
      (o) => o.taskType === taskType && o.difficulty === difficulty
    );
    if (slice.length === 0) return null;

    const n = slice.length;
    const avgQuality =
      slice.reduce((s, o) => s + o.actualQuality, 0) / n;
    let qualityPrior = clamp(avgQuality, 0, 1);

    const hadDefect = slice.filter(
      (o) => ((o as ModelObservation & { defectCount?: number }).defectCount ?? 0) > 0
    ).length;
    const defectRate = n > 0 ? hadDefect / n : undefined;
    if (defectRate != null && defectRate >= DEFECT_RATE_HIGH_THRESHOLD) {
      const penalty = Math.min(
        DEFECT_RATE_QUALITY_PENALTY_MAX,
        (defectRate - DEFECT_RATE_HIGH_THRESHOLD) * 0.2
      );
      qualityPrior = clamp(qualityPrior - penalty, 0, 1);
    }

    const costVarianceRatios = slice.map((o) => {
      const denom = Math.max(o.predictedCostUSD, 1e-9);
      return o.actualCostUSD / denom;
    });
    const avgCostRatio =
      costVarianceRatios.reduce((s, r) => s + r, 0) / n;
    const costMultiplier = clamp(avgCostRatio, COST_MULTIPLIER_MIN, COST_MULTIPLIER_MAX);

    const calibrationConfidence = clamp(Math.min(1, n / 100), 0, 1);

    const sorted = [...costVarianceRatios].sort((a, b) => a - b);
    const varianceBandLow = percentile(sorted, 20);
    const varianceBandHigh = percentile(sorted, 80);

    const now = new Date().toISOString();
    const prior: ModelPerformancePrior = {
      taskType,
      difficulty,
      qualityPrior,
      costMultiplier,
      calibrationConfidence,
      varianceBandLow,
      varianceBandHigh,
      lastUpdatedISO: now,
      sampleCount: n,
      ...(defectRate != null && { defectRate }),
    };

    const existingPriors = await storage.loadPriors(modelId);
    const others = existingPriors.filter(
      (p) => !(p.taskType === taskType && p.difficulty === difficulty)
    );
    await storage.savePriors(modelId, [...others, prior]);

    const model = await this.registry.getModel(modelId);
    if (model) {
      const gov = model.governance;
      const minQualityPrior = gov?.minQualityPrior ?? PROBATION_QUALITY_THRESHOLD;
      const maxCostVarianceRatio = gov?.maxCostVarianceRatio;
      const disableAutoDisable = gov?.disableAutoDisable === true;

      const qualityFails = qualityPrior < minQualityPrior;
      const costFails =
        maxCostVarianceRatio != null && avgCostRatio > maxCostVarianceRatio;
      const shouldProbation =
        n >= PROBATION_SAMPLE_MIN &&
        model.identity.status !== "disabled" &&
        (qualityFails || costFails);

      if (
        n >= PROBATION_TO_DISABLE_SAMPLE_MIN &&
        model.identity.status === "probation" &&
        (qualityFails || costFails) &&
        !disableAutoDisable
      ) {
        const autoApplyDisable = process.env.MODEL_HR_AUTO_APPLY_DISABLE === "1" || process.env.MODEL_HR_AUTO_APPLY_DISABLE === "true";
        if (autoApplyDisable) {
          try {
            emitModelHrSignal({
              modelId,
              previousStatus: "probation",
              newStatus: "disabled",
              reason: "auto_disabled_regression",
              sampleCount: n,
            });
          } catch {
            /* never fail run */
          }
          await this.registry.disableModel(modelId, "auto_disabled_regression");
        } else {
          try {
            await enqueueAction(modelId, "disable", "auto_disabled_regression", "evaluation");
          } catch {
            /* never fail run */
          }
        }
      } else if (shouldProbation) {
        try {
          emitModelHrSignal({
            modelId,
            previousStatus: model.identity.status,
            newStatus: "probation",
            reason: qualityFails ? "quality_below_threshold" : "cost_variance_exceeded",
            sampleCount: n,
          });
        } catch {
          /* never fail run */
        }
        const updated: ModelRegistryEntry = {
          ...model,
          identity: {
            ...model.identity,
            status: "probation" as ModelStatus,
          },
          updatedAtISO: now,
        };
        await this.registry.upsertModel(updated);
      } else if (
        n >= GRADUATE_SAMPLE_MIN &&
        qualityPrior >= GRADUATE_QUALITY_THRESHOLD &&
        model.identity.status === "probation"
      ) {
        const updated: ModelRegistryEntry = {
          ...model,
          identity: {
            ...model.identity,
            status: "active" as ModelStatus,
          },
          updatedAtISO: now,
        };
        await this.registry.upsertModel(updated);
      }
    }

    return prior;
  }

  async updatePriorsForObservation(obs: ModelObservation): Promise<ModelPerformancePrior | null> {
    return this.updatePriors(obs.modelId, obs.taskType, obs.difficulty);
  }
}
