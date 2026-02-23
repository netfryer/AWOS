/**
 * Model performance statistics tracker (observability only).
 * Persists per-model stats to disk.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { RunLogEvent } from "./runLog.js";

export interface ModelStats {
  modelId: string;
  totalRuns: number;
  successRuns: number;
  retryCount: number;
  executionErrors: number;
  validationFailures: number;
  totalActualCostUSD: number;
  totalQualityScore: number;
  evaluatedRuns: number;
}

export interface ModelStatsWithComputed extends ModelStats {
  successRate: number;
  errorRate: number;
  retryRate: number;
  avgActualCostUSD: number;
  avgQualityScore: number;
}

type PersistedStats = Record<string, ModelStats>;

const DEFAULT_LOG_PATH = "./runs/modelStats.json";

export class ModelStatsTracker {
  private stats: PersistedStats = {};
  private readonly logPath: string;
  private readonly ready: Promise<void>;

  constructor(logPath?: string) {
    this.logPath = logPath ?? DEFAULT_LOG_PATH;
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.logPath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedStats;
      if (parsed && typeof parsed === "object") {
        for (const [id, s] of Object.entries(parsed)) {
          this.stats[id] = {
            ...s,
            totalQualityScore: s.totalQualityScore ?? 0,
            evaluatedRuns: s.evaluatedRuns ?? 0,
          };
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("ModelStatsTracker: could not load stats file:", err);
      }
      this.stats = {};
    }
  }

  private ensureEntry(modelId: string): ModelStats {
    if (!this.stats[modelId]) {
      this.stats[modelId] = {
        modelId,
        totalRuns: 0,
        successRuns: 0,
        retryCount: 0,
        executionErrors: 0,
        validationFailures: 0,
        totalActualCostUSD: 0,
        totalQualityScore: 0,
        evaluatedRuns: 0,
      };
    }
    return this.stats[modelId];
  }

  async recordRun(runEvent: RunLogEvent): Promise<void> {
    await this.ready;
    for (const attempt of runEvent.attempts) {
      const entry = this.ensureEntry(attempt.modelId);
      entry.totalRuns += 1;

      if (attempt.execution.status === "error") {
        entry.executionErrors += 1;
      } else if (attempt.validation.ok === false) {
        entry.validationFailures += 1;
      }
      if (attempt.execution.status === "ok" && attempt.validation.ok === true) {
        entry.successRuns += 1;
      }
      if (runEvent.final.retryUsed && attempt.attempt > 1) {
        entry.retryCount += 1;
      }
      if (attempt.actualCostUSD != null) {
        entry.totalActualCostUSD += attempt.actualCostUSD;
      }
      const evalOverall =
        attempt.eval?.status === "ok" && typeof attempt.eval?.result?.overall === "number"
          ? attempt.eval.result.overall
          : null;
      const legacyScore = attempt.qualityScore;
      const scoreToUse = evalOverall ?? legacyScore;
      if (scoreToUse != null) {
        entry.totalQualityScore += scoreToUse;
        entry.evaluatedRuns += 1;
      }
    }

    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.logPath), { recursive: true });
      await writeFile(this.logPath, JSON.stringify(this.stats, null, 2), "utf-8");
    } catch (err) {
      console.warn("ModelStatsTracker: could not persist stats:", err);
    }
  }

  async getStats(): Promise<ModelStatsWithComputed[]> {
    await this.ready;
    return Object.values(this.stats).map((s) => {
      const totalRuns = s.totalRuns;
      const successRate = totalRuns > 0 ? s.successRuns / totalRuns : 0;
      const errorRate = totalRuns > 0 ? s.executionErrors / totalRuns : 0;
      const retryRate = totalRuns > 0 ? s.retryCount / totalRuns : 0;
      const avgActualCostUSD =
        s.successRuns > 0 ? s.totalActualCostUSD / s.successRuns : 0;
      const avgQualityScore =
        s.evaluatedRuns > 0 ? s.totalQualityScore / s.evaluatedRuns : 0;

      return {
        ...s,
        successRate,
        errorRate,
        retryRate,
        avgActualCostUSD,
        avgQualityScore,
      };
    });
  }
}

let trackerInstance: ModelStatsTracker | null = null;

export function getModelStatsTracker(logPath?: string): ModelStatsTracker {
  if (!trackerInstance) {
    trackerInstance = new ModelStatsTracker(logPath);
  }
  return trackerInstance;
}
