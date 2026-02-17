/**
 * Variance / calibration stats for forecast vs actual.
 * Persists per modelId:taskType buckets.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { TaskType } from "./types.js";

export interface VarianceBucket {
  modelId: string;
  taskType: TaskType;
  nCost: number;
  sumEstimatedCostUSD: number;
  sumActualCostUSD: number;
  nQuality: number;
  sumPredictedQuality: number;
  sumActualQuality: number;
}

const MIN_SAMPLES = 5;
const COST_MULTIPLIER_MIN = 0.3;
const COST_MULTIPLIER_MAX = 3.0;
const DEFAULT_PATH = "./runs/varianceStats.json";

type PersistedStats = Record<string, VarianceBucket>;

function bucketKey(modelId: string, taskType: TaskType): string {
  return `${modelId}:${taskType}`;
}

export class VarianceStatsTracker {
  private buckets: PersistedStats = {};
  private readonly path: string;
  private readonly ready: Promise<void>;

  constructor(path?: string) {
    this.path = path ?? DEFAULT_PATH;
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf-8");
      const parsed = JSON.parse(raw) as PersistedStats;
      if (parsed && typeof parsed === "object") {
        this.buckets = parsed;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("VarianceStatsTracker: could not load:", err);
      }
      this.buckets = {};
    }
  }

  private ensureBucket(modelId: string, taskType: TaskType): VarianceBucket {
    const key = bucketKey(modelId, taskType);
    if (!this.buckets[key]) {
      this.buckets[key] = {
        modelId,
        taskType,
        nCost: 0,
        sumEstimatedCostUSD: 0,
        sumActualCostUSD: 0,
        nQuality: 0,
        sumPredictedQuality: 0,
        sumActualQuality: 0,
      };
    }
    return this.buckets[key];
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.buckets, null, 2), "utf-8");
    } catch (err) {
      console.warn("VarianceStatsTracker: could not persist:", err);
    }
  }

  async recordSubtaskVariance(args: {
    modelId: string;
    taskType: TaskType;
    estimatedCostUSD: number;
    actualCostUSD?: number;
    predictedQuality: number;
    actualQuality?: number;
  }): Promise<void> {
    await this.ready;
    const b = this.ensureBucket(args.modelId, args.taskType);

    if (args.actualCostUSD != null) {
      b.nCost += 1;
      b.sumEstimatedCostUSD += args.estimatedCostUSD;
      b.sumActualCostUSD += args.actualCostUSD;
    }
    if (args.actualQuality != null) {
      b.nQuality += 1;
      b.sumPredictedQuality += args.predictedQuality;
      b.sumActualQuality += args.actualQuality;
    }

    await this.persist();
  }

  async getCalibration(
    modelId: string,
    taskType: TaskType
  ): Promise<{
    nCost: number;
    costMultiplier: number | null;
    nQuality: number;
    qualityBias: number | null;
  }> {
    await this.ready;
    const b = this.ensureBucket(modelId, taskType);

    let costMultiplier: number | null = null;
    if (b.nCost >= MIN_SAMPLES && b.sumEstimatedCostUSD > 0) {
      const raw = b.sumActualCostUSD / b.sumEstimatedCostUSD;
      costMultiplier = Math.max(
        COST_MULTIPLIER_MIN,
        Math.min(COST_MULTIPLIER_MAX, raw)
      );
    }

    let qualityBias: number | null = null;
    const nQuality = b.nQuality;
    if (nQuality >= MIN_SAMPLES && nQuality > 0) {
      const avgPredicted = b.sumPredictedQuality / nQuality;
      const avgActual = b.sumActualQuality / nQuality;
      qualityBias = avgActual - avgPredicted;
    }

    return {
      nCost: b.nCost,
      costMultiplier,
      nQuality,
      qualityBias,
    };
  }

  async getBuckets(): Promise<VarianceBucket[]> {
    await this.ready;
    return Object.values(this.buckets);
  }

  async getStats(): Promise<
    (VarianceBucket & {
      costMultiplier: number | null;
      qualityBias: number | null;
    })[]
  > {
    await this.ready;
    return Object.values(this.buckets).map((b) => {
      let costMultiplier: number | null = null;
      if (b.nCost >= MIN_SAMPLES && b.sumEstimatedCostUSD > 0) {
        const raw = b.sumActualCostUSD / b.sumEstimatedCostUSD;
        costMultiplier = Math.max(
          COST_MULTIPLIER_MIN,
          Math.min(COST_MULTIPLIER_MAX, raw)
        );
      }
      let qualityBias: number | null = null;
      if (b.nQuality >= MIN_SAMPLES && b.nQuality > 0) {
        qualityBias =
          b.sumActualQuality / b.nQuality - b.sumPredictedQuality / b.nQuality;
      }
      return { ...b, costMultiplier, qualityBias };
    });
  }
}

let trackerInstance: VarianceStatsTracker | null = null;

export function getVarianceStatsTracker(path?: string): VarianceStatsTracker {
  if (!trackerInstance) {
    trackerInstance = new VarianceStatsTracker(path);
  }
  return trackerInstance;
}
