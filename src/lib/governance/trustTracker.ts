/**
 * In-memory TrustTracker for model reliability scoring.
 * Split worker vs QA trust; EMA-like updates; time-aware decay.
 * Integrates with Model HR Evaluation: records observations when trust is updated.
 */

// ─── src/lib/governance/trustTracker.ts ─────────────────────────────────────

import { clamp01 } from "../schemas/governance.js";
import { recordObservation, updatePriorsForObservation } from "../model-hr/index.js";
import type { ModelObservation } from "../model-hr/index.js";

/**
 * Records a ModelObservation to Model HR (append + update priors).
 * Must not throw; catches storage errors (e.g. missing data dir) and logs.
 */
export async function recordObservationToModelHr(obs: ModelObservation): Promise<void> {
  try {
    await recordObservation(obs);
    await updatePriorsForObservation(obs);
  } catch (err) {
    console.warn("[TrustTracker] Model HR observation recording failed:", err);
  }
}

const DEFAULT_TRUST = 0.7;
const EMA_ALPHA = 0.15;
const QA_FAIL_PENALTY = 0.35;
const COST_VARIANCE_THRESHOLD = 1.3;
const COST_VARIANCE_PENALTY = 0.12;
const QA_AGREEMENT_ALPHA = 0.2;
const DECAY_GRACE_DAYS = 7;
const DECAY_PER_DAY = 0.01;
const TRUST_FLOOR = 0.35;

export type TrustRole = "worker" | "qa";

export interface TrustByRole {
  worker: number;
  qa: number;
  lastUpdatedISO?: string;
}

export interface TrustTracker {
  getTrust(modelId: string, role?: TrustRole): number;
  getLastUpdatedISO(modelId: string): string | undefined;
  updateTrust(
    modelId: string,
    predictedQuality: number,
    actualQuality: number,
    qaPass: boolean,
    costVarianceRatio: number
  ): number;
  updateTrustWorker(
    modelId: string,
    predictedQuality: number,
    actualQuality: number,
    qaPass: boolean,
    costVarianceRatio: number,
    nowISO?: string
  ): number;
  updateTrustQa(modelId: string, agreedWithDeterministic: boolean, confidenceSignal?: number, nowISO?: string): number;
  getTrustMap(): Record<string, number>;
  getTrustRoleMap(): Record<string, TrustByRole>;
}

export class InMemoryTrustTracker implements TrustTracker {
  private trust = new Map<string, TrustByRole>();

  private getEntry(modelId: string): TrustByRole {
    const e = this.trust.get(modelId);
    if (e) return e;
    const def: TrustByRole = { worker: DEFAULT_TRUST, qa: DEFAULT_TRUST };
    this.trust.set(modelId, def);
    return def;
  }

  private applyDecay(raw: number, lastUpdatedISO: string | undefined): number {
    if (!lastUpdatedISO) return raw;
    const then = new Date(lastUpdatedISO).getTime();
    const now = Date.now();
    const daysSince = (now - then) / (24 * 60 * 60 * 1000);
    if (daysSince <= DECAY_GRACE_DAYS) return raw;
    const extraDays = daysSince - DECAY_GRACE_DAYS;
    const decay = extraDays * DECAY_PER_DAY;
    return Math.max(TRUST_FLOOR, raw - decay);
  }

  getTrust(modelId: string, role: TrustRole = "worker"): number {
    const e = this.getEntry(modelId);
    return this.applyDecay(e[role], e.lastUpdatedISO);
  }

  getLastUpdatedISO(modelId: string): string | undefined {
    return this.getEntry(modelId).lastUpdatedISO;
  }

  updateTrust(
    modelId: string,
    predictedQuality: number,
    actualQuality: number,
    qaPass: boolean,
    costVarianceRatio: number
  ): number {
    return this.updateTrustWorker(modelId, predictedQuality, actualQuality, qaPass, costVarianceRatio);
  }

  updateTrustWorker(
    modelId: string,
    predictedQuality: number,
    actualQuality: number,
    qaPass: boolean,
    costVarianceRatio: number,
    nowISO?: string
  ): number {
    const e = this.getEntry(modelId);
    const current = e.worker;
    const iso = nowISO ?? new Date().toISOString();

    let delta = 0;
    const qualityDelta = actualQuality - predictedQuality;
    delta += clamp01(qualityDelta) * 0.1;
    delta -= clamp01(-qualityDelta) * 0.15;

    if (!qaPass) delta -= QA_FAIL_PENALTY;

    if (costVarianceRatio > COST_VARIANCE_THRESHOLD) {
      const excess = Math.min(1, (costVarianceRatio - COST_VARIANCE_THRESHOLD) / 0.7);
      delta -= excess * COST_VARIANCE_PENALTY;
    }

    const next = clamp01(current + EMA_ALPHA * delta);
    e.worker = next;
    e.lastUpdatedISO = iso;
    return next;
  }

  updateTrustQa(modelId: string, agreedWithDeterministic: boolean, confidenceSignal?: number, nowISO?: string): number {
    const e = this.getEntry(modelId);
    const current = e.qa;
    const iso = nowISO ?? new Date().toISOString();
    const delta = agreedWithDeterministic ? 0.1 : -0.15;
    const next = clamp01(current + QA_AGREEMENT_ALPHA * delta);
    e.qa = next;
    e.lastUpdatedISO = iso;
    return next;
  }

  getTrustMap(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.trust) {
      out[k] = this.applyDecay(v.worker, v.lastUpdatedISO);
    }
    return out;
  }

  getTrustRoleMap(): Record<string, TrustByRole> {
    const out: Record<string, TrustByRole> = {};
    for (const [k, v] of this.trust) {
      out[k] = {
        worker: this.applyDecay(v.worker, v.lastUpdatedISO),
        qa: this.applyDecay(v.qa, v.lastUpdatedISO),
        lastUpdatedISO: v.lastUpdatedISO,
      };
    }
    return out;
  }
}

export function trustWeightedScore(baseScore: number, trust: number): number {
  return baseScore * (0.5 + 0.5 * trust);
}

let trackerInstance: InMemoryTrustTracker | null = null;

export function getTrustTracker(): InMemoryTrustTracker {
  if (!trackerInstance) {
    trackerInstance = new InMemoryTrustTracker();
  }
  return trackerInstance;
}
