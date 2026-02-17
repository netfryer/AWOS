/**
 * Deterministic budget optimization: tier overrides, ROI rebalancing.
 * No LLM calls. Uses trust-weighted quality and variance-calibrated cost.
 */

// ─── src/lib/planning/optimizePlanBudgets.ts ─────────────────────────────────

import { estimateTokensForTask } from "../../router.js";
import { trustWeightedScore } from "../governance/trustTracker.js";
import type { ModelSpec, TaskCard, TaskType, Difficulty } from "../../types.js";
import type { ProjectPlan } from "../schemas/governance.js";
import type { ProjectSubtask, RecommendedTier } from "../../project/types.js";

export type TierProfile = "cheap" | "standard" | "premium";

export interface OptimizableSubtask extends ProjectSubtask {
  budgetUSD?: number;
  effectiveTier?: RecommendedTier;
  deferred?: boolean;
  underfunded?: boolean;
  shortfallUSD?: number;
}

export interface PlanWithSubtasks extends ProjectPlan {
  subtasks?: OptimizableSubtask[];
  budget?: { reserveUSD?: number; warnings?: string[] };
}

export interface OptimizePlanBudgetsArgs {
  projectBudgetUSD: number;
  tierProfile: TierProfile;
  modelRegistry: ModelSpec[];
  trustTracker: { getTrust: (modelId: string, role?: string) => number };
  varianceStatsTracker?: {
    getCalibration(modelId: string, taskType: string): Promise<{
      nCost: number;
      costMultiplier: number | null;
      nQuality: number;
      qualityBias: number | null;
    }>;
  };
}

export interface Reallocation {
  fromSubtaskId: string;
  toSubtaskId: string;
  amountUSD: number;
  reason: string;
}

const CHEAPEST_MODEL_ID = "gpt-4o-mini";
const PREMIUM_MODEL_IDS = new Set(["gpt-4o", "claude-sonnet-4-5-20250929"]);
const DIFFICULTY_WEIGHT: Record<string, number> = { low: 1, medium: 1.4, high: 1.8 };
const QUALITY_FLOOR = 0.72;
const IMPORTANCE_TIER_OVERRIDE = 5;
const ROI_REBALANCE_PCT = 0.1;
const REBALANCE_CAP_PCT = 0.25;
const MIN_COST_DONOR_CAP_PCT = 0.15;

function filterModelsByTier(models: ModelSpec[], tier?: RecommendedTier): ModelSpec[] {
  if (!tier || tier === "cheap") return models;
  if (tier === "standard") return models.filter((m) => m.id !== CHEAPEST_MODEL_ID);
  if (tier === "premium") return models.filter((m) => PREMIUM_MODEL_IDS.has(m.id));
  return models;
}

function computeCostUSD(
  model: ModelSpec,
  estimatedTokens: { input: number; output: number }
): number {
  return (
    (estimatedTokens.input / 1000) * model.pricing.inPer1k +
    (estimatedTokens.output / 1000) * model.pricing.outPer1k
  );
}

function tierOrder(t: RecommendedTier): number {
  return t === "cheap" ? 0 : t === "standard" ? 1 : 2;
}

function bumpTier(t: RecommendedTier): RecommendedTier {
  if (t === "cheap") return "standard";
  if (t === "standard") return "premium";
  return "premium";
}

export async function optimizePlanBudgets(
  plan: PlanWithSubtasks,
  args: OptimizePlanBudgetsArgs
): Promise<{ plan: PlanWithSubtasks; warnings: string[]; reallocations: Reallocation[] }> {
  const { projectBudgetUSD, tierProfile, modelRegistry, trustTracker, varianceStatsTracker } = args;
  const warnings: string[] = [];
  const reallocations: Reallocation[] = [];

  const reserveUSD = plan.budget?.reserveUSD ?? projectBudgetUSD * 0.1;
  const availableUSD = projectBudgetUSD - reserveUSD;

  const subtasks = plan.subtasks ?? [];
  if (subtasks.length === 0) {
    return { plan, warnings, reallocations };
  }

  const taskTypeMap: Record<string, TaskType> = {
    code: "code",
    writing: "writing",
    analysis: "analysis",
    general: "general",
  };

  interface SubtaskEst {
    subtask: OptimizableSubtask;
    minCostUSD: number;
    bestPredictedQuality: number;
    predictedCostUSD: number;
    effectiveTier: RecommendedTier;
  }

  const estimates: SubtaskEst[] = [];
  let minPremiumCostUSD = Infinity;
  const premiumModels = filterModelsByTier(modelRegistry, "premium");

  for (const s of subtasks) {
    let effectiveTier: RecommendedTier =
      (s.recommendedTier as RecommendedTier) ?? (tierProfile as RecommendedTier);
    const task: TaskCard = {
      id: s.id,
      taskType: taskTypeMap[s.taskType] ?? "general",
      difficulty: s.difficulty,
      constraints: {},
    };
    const estimatedTokens = estimateTokensForTask(task, s.description);

    let minCostUSD = Infinity;
    let bestPredictedQuality = 0;
    let predictedCostUSD = 0;

    const computeForTier = async (tier: RecommendedTier) => {
      const filtered = filterModelsByTier(modelRegistry, tier);
      let bestCost = Infinity;
      let bestQuality = 0;
      let bestCostForPred = 0;

      for (const m of filtered) {
        const rawCost = computeCostUSD(m, estimatedTokens);
        let cost = rawCost;
        if (varianceStatsTracker) {
          try {
            const cal = await varianceStatsTracker.getCalibration(m.id, s.taskType);
            if (cal.costMultiplier != null) cost = rawCost * cal.costMultiplier;
          } catch {
            /* ignore */
          }
        }
        const expertise = m.expertise[s.taskType] ?? m.expertise.general ?? 0.7;
        const trust = trustTracker.getTrust(m.id, "worker") ?? trustTracker.getTrust(m.id) ?? 0.7;
        let quality = trustWeightedScore(expertise, trust);
        if (varianceStatsTracker) {
          try {
            const cal = await varianceStatsTracker.getCalibration(m.id, s.taskType);
            if (cal.qualityBias != null) quality = Math.max(0, Math.min(1, quality + cal.qualityBias));
          } catch {
            /* ignore */
          }
        }
        if (cost < bestCost) bestCost = cost;
        if (quality > bestQuality) {
          bestQuality = quality;
          bestCostForPred = cost;
        }
      }

      return {
        minCost: bestCost === Infinity ? 0.01 : bestCost,
        bestQuality,
        predictedCost: bestCostForPred || bestCost || 0.01,
      };
    };

    let result = await computeForTier(effectiveTier);

    if (
      s.importance >= IMPORTANCE_TIER_OVERRIDE &&
      result.bestQuality < QUALITY_FLOOR &&
      effectiveTier !== "premium"
    ) {
      effectiveTier = bumpTier(effectiveTier);
      result = await computeForTier(effectiveTier);
      warnings.push(
        `Subtask "${s.title}" (${s.id}): tier bumped to ${effectiveTier} (importance ${s.importance}, quality ${result.bestQuality.toFixed(2)} < ${QUALITY_FLOOR})`
      );
    }
    // Tier hysteresis: upgrade only if bestPredictedQuality < 0.72; never downgrade in same run

    minCostUSD = result.minCost;
    bestPredictedQuality = result.bestQuality;
    predictedCostUSD = result.predictedCost;

    estimates.push({
      subtask: s,
      minCostUSD,
      bestPredictedQuality,
      predictedCostUSD,
      effectiveTier,
    });
  }

  for (const m of premiumModels) {
    for (const e of estimates) {
      const task: TaskCard = {
        id: e.subtask.id,
        taskType: taskTypeMap[e.subtask.taskType] ?? "general",
        difficulty: e.subtask.difficulty,
        constraints: {},
      };
      const tok = estimateTokensForTask(task, e.subtask.description);
      const c = computeCostUSD(m, tok);
      if (c < minPremiumCostUSD) minPremiumCostUSD = c;
    }
  }
  if (minPremiumCostUSD === Infinity) minPremiumCostUSD = 0.01;

  const totalWeight = estimates.reduce(
    (sum, e) => sum + e.subtask.importance * (DIFFICULTY_WEIGHT[e.subtask.difficulty] ?? 1.4),
    0
  ) || 1;

  for (const e of estimates) {
    const w = e.subtask.importance * (DIFFICULTY_WEIGHT[e.subtask.difficulty] ?? 1.4);
    e.subtask.budgetUSD = availableUSD * (w / totalWeight);
    e.subtask.effectiveTier = e.effectiveTier;
  }

  const byImportance = [...estimates].sort(
    (a, b) => a.subtask.importance - b.subtask.importance
  );
  let pool = availableUSD;
  const allocated = new Map<string, number>();
  for (const e of estimates) {
    allocated.set(e.subtask.id, e.subtask.budgetUSD ?? 0);
  }

  for (const e of byImportance) {
    const need = e.minCostUSD;
    const current = allocated.get(e.subtask.id) ?? 0;
    if (current < need && pool >= need) {
      const shortfall = need - current;
      const takeFrom = byImportance
        .filter((x) => x.subtask.importance < e.subtask.importance)
        .sort((a, b) => a.subtask.importance - b.subtask.importance);
      for (const donor of takeFrom) {
        if (shortfall <= 0) break;
        const donorAlloc = allocated.get(donor.subtask.id) ?? 0;
        const donorMin = donor.minCostUSD;
        const donorCap = donorAlloc * MIN_COST_DONOR_CAP_PCT;
        const canGive = Math.max(0, Math.min(donorAlloc - donorMin, donorCap));
        if (canGive > 0) {
          const give = Math.min(shortfall, canGive);
          allocated.set(donor.subtask.id, donorAlloc - give);
          allocated.set(e.subtask.id, (allocated.get(e.subtask.id) ?? 0) + give);
          pool -= give;
          reallocations.push({
            fromSubtaskId: donor.subtask.id,
            toSubtaskId: e.subtask.id,
            amountUSD: give,
            reason: "min_cost_floor",
          });
        }
      }
    }
  }

  const deferred: string[] = [];
  const canDeferImportance4 = projectBudgetUSD < minPremiumCostUSD;

  const protectedHigh = estimates.filter(
    (e) => e.subtask.importance >= 4 && !canDeferImportance4
  );
  for (const e of protectedHigh) {
    const need = e.minCostUSD;
    let current = allocated.get(e.subtask.id) ?? 0;
    if (current < need) {
      const shortfall = need - current;
      const donors = byImportance.filter(
        (x) => x.subtask.importance < 4 && (allocated.get(x.subtask.id) ?? 0) > x.minCostUSD
      );
      for (const d of donors) {
        if (shortfall <= 0) break;
        const donorAlloc = allocated.get(d.subtask.id) ?? 0;
        const donorCap = donorAlloc * MIN_COST_DONOR_CAP_PCT;
        const canGive = Math.max(0, Math.min(donorAlloc - d.minCostUSD, donorCap));
        if (canGive > 0) {
          const give = Math.min(shortfall, canGive);
          allocated.set(d.subtask.id, donorAlloc - give);
          allocated.set(e.subtask.id, (allocated.get(e.subtask.id) ?? 0) + give);
          current += give;
          reallocations.push({
            fromSubtaskId: d.subtask.id,
            toSubtaskId: e.subtask.id,
            amountUSD: give,
            reason: "protect_importance4",
          });
        }
      }
    }
  }

  for (const e of estimates) {
    const need = e.minCostUSD;
    const current = allocated.get(e.subtask.id) ?? 0;
    const wouldDefer = current < need;
    const protectImportance4 = e.subtask.importance >= 4 && !canDeferImportance4;
    if (wouldDefer && protectImportance4) {
      e.subtask.deferred = false;
      e.subtask.budgetUSD = current;
      allocated.set(e.subtask.id, current);
    } else if (wouldDefer) {
      e.subtask.deferred = true;
      e.subtask.budgetUSD = 0;
      deferred.push(e.subtask.id);
      const reclaimed = current;
      pool += reclaimed;
      allocated.set(e.subtask.id, 0);
    } else {
      e.subtask.budgetUSD = current;
      e.subtask.deferred = false;
    }
  }

  if (deferred.length > 0) {
    warnings.push(
      `Deferred ${deferred.length} subtask(s) due to insufficient budget: ${deferred.join(", ")}`
    );
  }

  const underfunded = deferred.length > 0;
  if (!underfunded && estimates.length >= 2) {
    const withROI = estimates.map((e) => {
      const cost = Math.max(0.01, e.predictedCostUSD);
      const weight = e.subtask.importance * (DIFFICULTY_WEIGHT[e.subtask.difficulty] ?? 1.4);
      const roi = (weight * e.bestPredictedQuality) / cost;
      return { ...e, roi };
    });
    withROI.sort((a, b) => a.roi - b.roi);
    const q = Math.max(1, Math.floor(withROI.length / 4));
    const bottom = withROI.slice(0, q).filter((b) => !deferred.includes(b.subtask.id));
    const top = withROI.slice(-q).filter((t) => !deferred.includes(t.subtask.id));
    const totalToMove = Math.min(availableUSD * ROI_REBALANCE_PCT, 9999);
    if (bottom.length > 0 && top.length > 0 && totalToMove > 0.001) {
      const donorContrib: { id: string; amount: number }[] = [];
      let pool = 0;
      for (const d of bottom) {
        if (pool >= totalToMove) break;
        const current = allocated.get(d.subtask.id) ?? 0;
        const cap = Math.min(current * REBALANCE_CAP_PCT, Math.max(0, current - d.minCostUSD));
        const take = Math.min(cap, totalToMove - pool);
        if (take > 0.001) {
          allocated.set(d.subtask.id, current - take);
          pool += take;
          donorContrib.push({ id: d.subtask.id, amount: take });
        }
      }
      const perRec = pool / top.length;
      let donorIdx = 0;
      for (const r of top) {
        const recCurrent = allocated.get(r.subtask.id) ?? 0;
        const recCap = recCurrent * REBALANCE_CAP_PCT;
        const give = Math.min(perRec, recCap, pool);
        if (give > 0.001 && pool > 0 && donorContrib.length > 0) {
          allocated.set(r.subtask.id, recCurrent + give);
          pool -= give;
          const donor = donorContrib[donorIdx % donorContrib.length];
          reallocations.push({
            fromSubtaskId: donor.id,
            toSubtaskId: r.subtask.id,
            amountUSD: give,
            reason: "roi_rebalance",
          });
          donorIdx++;
        }
      }
    }
    for (const e of estimates) {
      e.subtask.budgetUSD = allocated.get(e.subtask.id) ?? e.subtask.budgetUSD ?? 0;
    }
  }

  for (const e of estimates) {
    const budgetUSD = e.subtask.budgetUSD ?? 0;
    const minCostUSD = e.minCostUSD;
    e.subtask.underfunded = budgetUSD > 0 && budgetUSD < minCostUSD;
    e.subtask.shortfallUSD = Math.max(0, minCostUSD - budgetUSD);
  }

  const criticalUnderfunded = estimates.filter(
    (e) => e.subtask.underfunded && e.subtask.importance >= 4
  );
  if (criticalUnderfunded.length > 0) {
    warnings.push(
      `critical_underfunded:${criticalUnderfunded.length} subtasks importance>=4 below min cost; shortfalls present`
    );
  }

  if (!plan.budget) plan.budget = {};
  plan.budget.warnings = [...(plan.budget?.warnings ?? []), ...warnings];

  return { plan, warnings, reallocations };
}
