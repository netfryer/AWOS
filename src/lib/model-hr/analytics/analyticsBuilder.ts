/**
 * Aggregated analytics for Model HR and routing quality.
 * Sources: registry-fallback, signals, observations, ledger (in-memory), models.
 * Caps observations at 5k. Handles missing files gracefully.
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import type { ModelObservation } from "../types.js";
import { getAnalyticsObservationCap } from "../config.js";

const OBSERVATIONS_PER_MODEL = 100;

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

export interface ModelHrAnalytics {
  success: boolean;
  windowHours: number;
  registry: { health: "OK" | "FALLBACK"; fallbackCount: number };
  routing: {
    totalRoutes: number;
    enforceCheapestViableRate: number;
    chosenIsCheapestViableRate: number;
    pricingMismatchRoutes: number;
  };
  cost: {
    avgVarianceRatio: number;
    p80VarianceRatio: number;
    totalActualUSD: number;
    totalPredictedUSD: number;
  };
  quality: {
    avgActualQuality: number;
    avgPredictedQuality: number;
    calibrationError: number;
  };
  escalations: {
    count: number;
    byReason: Record<string, number>;
    topModels: { modelId: string; count: number }[];
  };
  models: { active: number; probation: number; deprecated: number; disabled: number };
}

async function getFallbackCount(hours: number): Promise<number> {
  try {
    const path = join(getDataDir(), "registry-fallback.jsonl");
    const raw = await readFile(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    let count = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]) as { tsISO?: string };
        if (obj?.tsISO && obj.tsISO >= cutoff) count++;
        else if (obj?.tsISO && obj.tsISO < cutoff) break;
      } catch {
        /* skip */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function loadObservationsBounded(hours: number): Promise<ModelObservation[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const observations: ModelObservation[] = [];
  try {
    const obsDir = join(getDataDir(), "observations");
    const files = await readdir(obsDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(obsDir, f), "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        const arr = Array.isArray(parsed) ? (parsed as ModelObservation[]) : [];
        arr.sort((a, b) => (b.tsISO ?? "").localeCompare(a.tsISO ?? ""));
        for (const o of arr.slice(0, OBSERVATIONS_PER_MODEL)) {
          if ((o.tsISO ?? "") >= cutoff) observations.push(o);
        }
      } catch {
        /* skip file */
      }
      if (observations.length >= getAnalyticsObservationCap()) break;
    }
    observations.sort((a, b) => (b.tsISO ?? "").localeCompare(a.tsISO ?? ""));
    return observations.slice(0, getAnalyticsObservationCap());
  } catch {
    return [];
  }
}

async function loadModelsCounts(): Promise<{ active: number; probation: number; deprecated: number; disabled: number }> {
  try {
    const path = join(getDataDir(), "models.json");
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [];
    const counts = { active: 0, probation: 0, deprecated: 0, disabled: 0 };
    for (const m of arr) {
      const status = (m as { identity?: { status?: string } })?.identity?.status;
      if (status === "active") counts.active++;
      else if (status === "probation") counts.probation++;
      else if (status === "deprecated") counts.deprecated++;
      else if (status === "disabled") counts.disabled++;
    }
    return counts;
  } catch {
    return { active: 0, probation: 0, deprecated: 0, disabled: 0 };
  }
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

export async function buildModelHrAnalytics(
  windowHours: number,
  ledgerStore?: { listLedgers: () => Array<{ runSessionId: string; startedAtISO: string }>; getLedger: (id: string) => { decisions: Array<{ type: string; details?: Record<string, unknown> }> } | undefined }
): Promise<ModelHrAnalytics> {
  const fallbackCount = await getFallbackCount(windowHours);
  const observations = await loadObservationsBounded(windowHours);
  const modelCounts = await loadModelsCounts();

  const costRatios: number[] = [];
  let totalActualUSD = 0;
  let totalPredictedUSD = 0;
  let sumActualQuality = 0;
  let sumPredictedQuality = 0;
  let qualityCount = 0;

  for (const o of observations) {
    if (typeof o.actualCostUSD === "number" && typeof o.predictedCostUSD === "number" && o.predictedCostUSD > 0) {
      costRatios.push(o.actualCostUSD / o.predictedCostUSD);
      totalActualUSD += o.actualCostUSD;
      totalPredictedUSD += o.predictedCostUSD;
    }
    if (typeof o.actualQuality === "number") {
      sumActualQuality += o.actualQuality;
      qualityCount++;
    }
    if (typeof o.predictedQuality === "number") {
      sumPredictedQuality += o.predictedQuality;
    }
  }

  const avgVarianceRatio = costRatios.length > 0 ? costRatios.reduce((a, b) => a + b, 0) / costRatios.length : 0;
  const sorted = [...costRatios].sort((a, b) => a - b);
  const p80VarianceRatio = percentile(sorted, 80);

  const n = qualityCount || 1;
  const avgActualQuality = sumActualQuality / n;
  const avgPredictedQuality = sumPredictedQuality / n;
  const calibrationError = Math.abs(avgActualQuality - avgPredictedQuality);

  let totalRoutes = 0;
  let enforceCheapestViableCount = 0;
  let chosenIsCheapestViableCount = 0;
  let pricingMismatchRoutes = 0;
  const escalationReasons: Record<string, number> = {};
  const escalationByModel: Record<string, number> = {};

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  if (ledgerStore) {
    const ledgers = ledgerStore.listLedgers();
    for (const item of ledgers) {
      if (item.startedAtISO < cutoff) continue;
      const ledger = ledgerStore.getLedger(item.runSessionId);
      if (!ledger) continue;
      for (const d of ledger.decisions) {
        if (d.type === "ROUTE") {
          totalRoutes++;
          if (d.details?.enforceCheapestViable === true) enforceCheapestViableCount++;
          if (d.details?.chosenIsCheapestViable === true) chosenIsCheapestViableCount++;
          const pm = d.details?.pricingMismatchCount as number | undefined;
          if (typeof pm === "number" && pm > 0) pricingMismatchRoutes += pm;
        }
        if (d.type === "ESCALATION") {
          const reason = String((d.details?.reason as string) ?? "unknown");
          escalationReasons[reason] = (escalationReasons[reason] ?? 0) + 1;
          const modelId = (d.details?.context as { modelId?: string })?.modelId;
          if (modelId) {
            escalationByModel[modelId] = (escalationByModel[modelId] ?? 0) + 1;
          }
        }
      }
    }
  }

  const topModels = Object.entries(escalationByModel)
    .map(([modelId, count]) => ({ modelId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const routeDenom = totalRoutes || 1;
  return {
    success: true,
    windowHours,
    registry: {
      health: fallbackCount > 0 ? "FALLBACK" : "OK",
      fallbackCount,
    },
    routing: {
      totalRoutes,
      enforceCheapestViableRate: enforceCheapestViableCount / routeDenom,
      chosenIsCheapestViableRate: chosenIsCheapestViableCount / routeDenom,
      pricingMismatchRoutes,
    },
    cost: {
      avgVarianceRatio,
      p80VarianceRatio,
      totalActualUSD,
      totalPredictedUSD,
    },
    quality: {
      avgActualQuality,
      avgPredictedQuality,
      calibrationError,
    },
    escalations: {
      count: Object.values(escalationReasons).reduce((a, b) => a + b, 0),
      byReason: escalationReasons,
      topModels,
    },
    models: modelCounts,
  };
}
