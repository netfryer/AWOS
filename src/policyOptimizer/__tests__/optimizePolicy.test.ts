/**
 * Stage 6: Policy Optimizer unit tests.
 */

import { describe, it, expect } from "vitest";
import { optimizePolicy } from "../optimizePolicy.js";
import type { PolicyStatsInput } from "../types.js";
import type { EscalationConfig } from "../../../types.js";

const DEFAULT_CONFIG: EscalationConfig = {
  policy: "promote_on_low_score",
  maxPromotions: 1,
  promotionMargin: 0.02,
  minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
  cheapFirstMaxGapByDifficulty: { low: 0.06, medium: 0.08, high: 0.1 },
  cheapFirstMinConfidence: 0.4,
  cheapFirstSavingsMinPct: 0.3,
};

function makeStats(overrides: Partial<PolicyStatsInput>): PolicyStatsInput {
  return {
    totals: {
      runs: 30,
      cheapFirstRate: 0.25,
      escalationRate: 0.1,
      avgEstimatedSavingsPct: 0.2,
      avgRealizedTotalCostUSD: 0.003,
      avgFinalScore: 0.88,
    },
    byTaskType: {},
    byDifficulty: {},
    regret: { count: 0 },
    economicRegret: { count: 0 },
    ...overrides,
  };
}

describe("optimizePolicy", () => {
  it("returns insufficient data when runs < 20", () => {
    const stats = makeStats({
      totals: { ...makeStats({}).totals, runs: 15 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(result.health).toBe("healthy");
    expect(result.summary).toContain("Insufficient data");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].severity).toBe("info");
    expect(result.recommendations[0].evidenceRuns).toBe(15);
    expect(result.recommendations[0].confidence).toBe("low");
  });

  it("healthy system: cheapFirst ~0.25, escalation ~0.1, no regret", () => {
    const stats = makeStats({
      totals: { ...makeStats({}).totals, cheapFirstRate: 0.25, escalationRate: 0.1 },
      regret: { count: 0 },
      economicRegret: { count: 0 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(result.health).toBe("healthy");
    expect(result.summary).toContain("healthy");
    expect(result.summary).toContain("zero regret");
    expect(result.recommendations.length).toBe(0);
  });

  it("conservative system: cheapFirst < 0.15, no regret", () => {
    const stats = makeStats({
      totals: { ...makeStats({}).totals, cheapFirstRate: 0.08, escalationRate: 0.05 },
      regret: { count: 0 },
      economicRegret: { count: 0 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(result.health).toBe("conservative");
    expect(result.summary).toContain("conservative");
    const gapRec = result.recommendations.find(
      (r) => r.parameter === "cheapFirstMaxGapByDifficulty" && r.target === "medium"
    );
    expect(gapRec).toBeDefined();
    expect(gapRec!.suggestedValue).toBe(0.1);
    const savingsRec = result.recommendations.find((r) => r.parameter === "cheapFirstSavingsMinPct");
    expect(savingsRec).toBeDefined();
    expect(savingsRec!.suggestedValue).toBe(0.25);
  });

  it("aggressive system: regret > 0", () => {
    const stats = makeStats({
      regret: { count: 3 },
      economicRegret: { count: 0 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(result.health).toBe("aggressive");
    expect(result.summary).toContain("aggressive");
    const minConfRec = result.recommendations.find((r) => r.parameter === "cheapFirstMinConfidence");
    expect(minConfRec).toBeDefined();
    expect(minConfRec!.suggestedValue).toBe(0.45);
    const gapRec = result.recommendations.find(
      (r) => r.parameter === "cheapFirstMaxGapByDifficulty" && r.target === "high"
    );
    expect(gapRec).toBeDefined();
    expect(gapRec!.suggestedValue).toBe(0.08);
  });

  it("economic regret scenario", () => {
    const stats = makeStats({
      regret: { count: 0 },
      economicRegret: { count: 2 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(result.health).toBe("aggressive");
    const savingsRec = result.recommendations.find((r) => r.parameter === "cheapFirstSavingsMinPct");
    expect(savingsRec).toBeDefined();
    expect(savingsRec!.suggestedValue).toBe(0.35);
  });

  it("high escalation rate", () => {
    const stats = makeStats({
      totals: { ...makeStats({}).totals, escalationRate: 0.35 },
      regret: { count: 0 },
      economicRegret: { count: 0 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    const gapRec = result.recommendations.find(
      (r) => r.parameter === "cheapFirstMaxGapByDifficulty" && r.target === "high"
    );
    expect(gapRec).toBeDefined();
    expect(gapRec!.suggestedValue).toBe(0.08);
  });

  it("recommendations are clamped", () => {
    const config: EscalationConfig = {
      ...DEFAULT_CONFIG,
      cheapFirstMinConfidence: 0.85,
      cheapFirstSavingsMinPct: 0.02,
      cheapFirstMaxGapByDifficulty: { low: 0.02, medium: 0.03, high: 0.02 },
    };
    const stats = makeStats({
      totals: { ...makeStats({}).totals, cheapFirstRate: 0.08 },
      regret: { count: 0 },
    });
    const result = optimizePolicy(stats, config);
    const savingsRec = result.recommendations.find((r) => r.parameter === "cheapFirstSavingsMinPct");
    if (savingsRec) {
      expect(savingsRec.suggestedValue).toBeGreaterThanOrEqual(0.05);
      expect(savingsRec.suggestedValue).toBeLessThanOrEqual(0.8);
    }
    const gapRecs = result.recommendations.filter((r) => r.parameter === "cheapFirstMaxGapByDifficulty");
    for (const r of gapRecs) {
      expect(r.suggestedValue).toBeGreaterThanOrEqual(0.02);
      expect(r.suggestedValue).toBeLessThanOrEqual(0.2);
    }
  });

  it("deterministic: same input produces same output", () => {
    const stats = makeStats({ regret: { count: 1 } });
    const r1 = optimizePolicy(stats, DEFAULT_CONFIG);
    const r2 = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(r1.health).toBe(r2.health);
    expect(r1.summary).toBe(r2.summary);
    expect(r1.recommendations).toHaveLength(r2.recommendations.length);
    for (let i = 0; i < r1.recommendations.length; i++) {
      expect(r1.recommendations[i].suggestedValue).toBe(r2.recommendations[i].suggestedValue);
    }
  });

  it("unstable when regret > 0 and escalationRate > 0.25", () => {
    const stats = makeStats({
      totals: { ...makeStats({}).totals, escalationRate: 0.3 },
      regret: { count: 2 },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    expect(result.health).toBe("unstable");
  });

  it("task-type signal: cheapFirst 0, escalation > 0.3, severity info when runs < 30", () => {
    const stats = makeStats({
      byTaskType: {
        writing: {
          runs: 15,
          cheapFirstRate: 0,
          escalationRate: 0.4,
          avgSavingsUSD: 0,
          avgRealizedCostUSD: 0.005,
          avgFinalScore: 0.85,
        },
      },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    const ttRec = result.recommendations.find(
      (r) => r.scope === "taskType" && r.target === "writing" && r.parameter === "cheapFirstMaxGapByDifficulty"
    );
    expect(ttRec).toBeDefined();
    expect(ttRec!.suggestedValue).toBe(0.12);
    expect(ttRec!.severity).toBe("info");
    expect(ttRec!.evidenceRuns).toBe(15);
    expect(ttRec!.confidence).toBe("low");
  });

  it("task-type signal: severity adjust when slice runs >= 30", () => {
    const stats = makeStats({
      byTaskType: {
        writing: {
          runs: 35,
          cheapFirstRate: 0,
          escalationRate: 0.4,
          avgSavingsUSD: 0,
          avgRealizedCostUSD: 0.005,
          avgFinalScore: 0.85,
        },
      },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    const ttRec = result.recommendations.find(
      (r) => r.scope === "taskType" && r.target === "writing" && r.parameter === "cheapFirstMaxGapByDifficulty"
    );
    expect(ttRec).toBeDefined();
    expect(ttRec!.severity).toBe("adjust");
    expect(ttRec!.evidenceRuns).toBe(35);
    expect(ttRec!.confidence).toBe("medium");
  });

  it("Stage 6.3: task-type uses primaryBlocker savingsPct → recommends savings not gap", () => {
    const stats = makeStats({
      byTaskType: {
        writing: {
          runs: 25,
          cheapFirstRate: 0,
          escalationRate: 0.4,
          avgSavingsUSD: 0,
          avgRealizedCostUSD: 0.005,
          avgFinalScore: 0.85,
        },
      },
      primaryBlockerCounts: {
        totals: { savingsPct: 10, confidence: 2, gap: 0 },
        byTaskType: { writing: { savingsPct: 8, confidence: 1 } },
        byDifficulty: {},
      },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    const gapRec = result.recommendations.find(
      (r) => r.scope === "taskType" && r.target === "writing" && r.parameter === "cheapFirstMaxGapByDifficulty"
    );
    const savingsRec = result.recommendations.find(
      (r) => r.scope === "taskType" && r.target === "writing" && r.parameter === "cheapFirstSavingsMinPct"
    );
    expect(gapRec).toBeUndefined();
    expect(savingsRec).toBeDefined();
    expect(savingsRec!.rationale).toContain("Primary blocker: savings");
  });

  it("Stage 6.3: task-type uses primaryBlocker confidence → recommends confidence not gap", () => {
    const stats = makeStats({
      byTaskType: {
        writing: {
          runs: 25,
          cheapFirstRate: 0,
          escalationRate: 0.4,
          avgSavingsUSD: 0,
          avgRealizedCostUSD: 0.005,
          avgFinalScore: 0.85,
        },
      },
      primaryBlockerCounts: {
        totals: { confidence: 12, savingsPct: 1 },
        byTaskType: { writing: { confidence: 10 } },
        byDifficulty: {},
      },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    const gapRec = result.recommendations.find(
      (r) => r.scope === "taskType" && r.target === "writing" && r.parameter === "cheapFirstMaxGapByDifficulty"
    );
    const confRec = result.recommendations.find(
      (r) => r.scope === "taskType" && r.target === "writing" && r.parameter === "cheapFirstMinConfidence"
    );
    expect(gapRec).toBeUndefined();
    expect(confRec).toBeDefined();
    expect(confRec!.rationale).toContain("Primary blocker: confidence");
  });

  it("Stage 6.3: conservative uses primaryBlocker savingsPct → recommends savings not gap", () => {
    const stats = makeStats({
      totals: { ...makeStats({}).totals, cheapFirstRate: 0.08, escalationRate: 0.05 },
      regret: { count: 0 },
      economicRegret: { count: 0 },
      primaryBlockerCounts: {
        totals: { savingsPct: 15, gap: 2 },
        byTaskType: {},
        byDifficulty: {},
      },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    const gapRec = result.recommendations.find(
      (r) => r.parameter === "cheapFirstMaxGapByDifficulty" && r.target === "medium"
    );
    const savingsRec = result.recommendations.find((r) => r.parameter === "cheapFirstSavingsMinPct");
    expect(gapRec).toBeUndefined();
    expect(savingsRec).toBeDefined();
    expect(savingsRec!.rationale).toContain("Primary blocker: savings");
  });

  it("suggestedValue rounded to 3 decimals", () => {
    const stats = makeStats({
      byTaskType: {
        writing: {
          runs: 15,
          cheapFirstRate: 0,
          escalationRate: 0.4,
          avgSavingsUSD: 0,
          avgRealizedCostUSD: 0.005,
          avgFinalScore: 0.85,
        },
      },
    });
    const result = optimizePolicy(stats, DEFAULT_CONFIG);
    for (const r of result.recommendations) {
      expect(r.suggestedValue).toBe(Math.round(r.suggestedValue * 1000) / 1000);
      if (r.currentValue != null) {
        expect(r.currentValue).toBe(Math.round(r.currentValue * 1000) / 1000);
      }
    }
  });
});
