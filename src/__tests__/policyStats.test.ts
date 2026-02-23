/**
 * Unit tests for Stage 5.3 policy stats aggregation.
 */

import { describe, it, expect } from "vitest";
import { aggregatePolicyStats } from "../policyStats.js";
import type { RunLogEvent } from "../runLog.js";

function makeEvent(overrides: Partial<RunLogEvent> & { policyEval?: Partial<RunLogEvent["policyEval"]> }): RunLogEvent {
  const pe = overrides.policyEval;
  const { policyEval: _pe, ...rest } = overrides;
  const base: RunLogEvent = {
    runId: "r1",
    ts: "2025-01-01T00:00:00Z",
    taskId: "t1",
    taskType: "analysis",
    difficulty: "high",
    routing: { chosenModelId: "gpt-4o", status: "ok", expectedCostUSD: 0.01, fallbackModelIds: [], estimatedTokens: { input: 1000, output: 500 }, rationale: "test" },
    expectedCostUSD: 0.01,
    attempts: [],
    final: { status: "ok", chosenModelId: "gpt-4o", retryUsed: false },
  };
  const merged = { ...base, ...rest };
  if (pe !== undefined) {
    (merged as RunLogEvent).policyEval = {
      enabled: true,
      selectionPolicy: "lowest_cost_qualified",
      routingMode: "escalation_aware",
      taskType: "analysis",
      difficulty: "high",
      profile: "fast",
      normalChoice: { modelId: "gpt-4o", expectedCostUSD: 0.01, threshold: 0.85, expertise: 0.9 },
      chosenAttempt1: { modelId: "gpt-4o-mini", expectedCostUSD: 0.002, expertise: 0.78 },
      usedCheapFirst: true,
      estimatedSavingsUSD: 0.008,
      estimatedSavingsPct: 0.8,
      result: { escalationUsed: false, finalModelId: "gpt-4o-mini" },
      ...pe,
    } as RunLogEvent["policyEval"];
  }
  return merged as RunLogEvent;
}

describe("aggregatePolicyStats", () => {
  it("returns empty totals when no events", () => {
    const out = aggregatePolicyStats([]);
    expect(out.totals.runs).toBe(0);
    expect(out.totals.usedCheapFirst).toBe(0);
    expect(out.totals.cheapFirstRate).toBe(0);
    expect(out.totals.escalations).toBe(0);
    expect(out.totals.escalationRate).toBe(0);
    expect(out.regret.count).toBe(0);
    expect(out.regret.examples).toEqual([]);
    expect(out.economicRegret.count).toBe(0);
    expect(out.economicRegret.examples).toEqual([]);
    expect(out.gateRejectionCounts.totals).toEqual({ savingsPct: 0, confidence: 0, gap: 0, noPromotionTarget: 0, budget: 0 });
    expect(out.gateReasonCounts).toEqual({});
    expect(out.primaryBlockerCounts).toEqual({ totals: {}, byTaskType: {}, byDifficulty: {} });
  });

  it("ignores events without policyEval.enabled", () => {
    const noPolicy = makeEvent({ runId: "r1" });
    const disabled = makeEvent({ runId: "r2", policyEval: { enabled: false } });
    const events: RunLogEvent[] = [noPolicy, disabled];
    const out = aggregatePolicyStats(events);
    expect(out.totals.runs).toBe(0);
  });

  it("aggregates totals correctly for synthetic events", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: true,
          estimatedSavingsUSD: 0.01,
          estimatedSavingsPct: 0.5,
          result: { escalationUsed: false, finalModelId: "m1", realizedTotalCostUSD: 0.005, finalScore: 0.85, targetScore: 0.88 },
        },
      }),
      makeEvent({
        runId: "r2",
        policyEval: {
          usedCheapFirst: false,
          estimatedSavingsUSD: 0,
          estimatedSavingsPct: 0,
          result: { escalationUsed: true, finalModelId: "m2", realizedTotalCostUSD: 0.02, finalScore: 0.9, targetScore: 0.88 },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.totals.runs).toBe(2);
    expect(out.totals.usedCheapFirst).toBe(1);
    expect(out.totals.cheapFirstRate).toBe(0.5);
    expect(out.totals.escalations).toBe(1);
    expect(out.totals.escalationRate).toBe(0.5);
    expect(out.totals.avgEstimatedSavingsUSD).toBeCloseTo(0.005);
    expect(out.totals.avgEstimatedSavingsPct).toBeCloseTo(0.25);
    expect(out.totals.avgRealizedTotalCostUSD).toBeCloseTo(0.0125);
    expect(out.totals.avgFinalScore).toBeCloseTo(0.875);
  });

  it("identifies regret cases: cheap-first used, no escalation, finalScore < targetScore", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: true,
          estimatedSavingsUSD: 0.01,
          result: { escalationUsed: false, finalModelId: "m1", finalScore: 0.82, targetScore: 0.88 },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.regret.count).toBe(1);
    expect(out.regret.examples).toHaveLength(1);
    expect(out.regret.examples[0].runId).toBe("r1");
    expect(out.regret.examples[0].finalScore).toBe(0.82);
    expect(out.regret.examples[0].targetScore).toBe(0.88);
    expect(out.regret.examples[0].escalationUsed).toBe(false);
  });

  it("does not count regret when escalation was used", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: true,
          result: { escalationUsed: true, finalModelId: "m2", finalScore: 0.82, targetScore: 0.88 },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.regret.count).toBe(0);
    expect(out.regret.examples).toEqual([]);
  });

  it("does not count regret when finalScore >= targetScore", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: true,
          result: { escalationUsed: false, finalModelId: "m1", finalScore: 0.9, targetScore: 0.88 },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.regret.count).toBe(0);
  });

  it("identifies economic regret: cheap-first + escalation, realizedCost > normalExpectedCost", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: true,
          normalChoice: { modelId: "gpt-4o", expectedCostUSD: 0.01, threshold: 0.85, expertise: 0.9 },
          estimatedSavingsUSD: 0.005,
          result: { escalationUsed: true, finalModelId: "gpt-4o", realizedTotalCostUSD: 0.015 },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.economicRegret.count).toBe(1);
    expect(out.economicRegret.examples[0].realizedTotalCostUSD).toBe(0.015);
    expect(out.economicRegret.examples[0].normalChoiceExpectedCostUSD).toBe(0.01);
  });

  it("aggregates gateRejectionCounts and gateReasonCounts when cheap-first rejected", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: false,
          gateReason: "rejected: no_cheap_first_candidates",
          gateRejectionCounts: { savingsPct: 2, confidence: 5, gap: 1, noPromotionTarget: 0, budget: 0 },
          taskType: "writing",
          difficulty: "high",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
      makeEvent({
        runId: "r2",
        policyEval: {
          usedCheapFirst: false,
          gateReason: "rejected: no_cheap_first_candidates",
          gateRejectionCounts: { savingsPct: 0, confidence: 3, gap: 2, noPromotionTarget: 1, budget: 0 },
          taskType: "writing",
          difficulty: "high",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
      makeEvent({
        runId: "r3",
        policyEval: {
          usedCheapFirst: false,
          gateReason: "rejected: no_calibration_confidence",
          taskType: "code",
          difficulty: "medium",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.gateReasonCounts["rejected: no_cheap_first_candidates"]).toBe(2);
    expect(out.gateReasonCounts["rejected: no_calibration_confidence"]).toBe(1);
    expect(out.gateRejectionCounts.totals).toEqual({ savingsPct: 2, confidence: 8, gap: 3, noPromotionTarget: 1, budget: 0 });
    expect(out.gateRejectionCounts.byTaskType.writing).toEqual({ savingsPct: 2, confidence: 8, gap: 3, noPromotionTarget: 1, budget: 0 });
    expect(out.gateRejectionCounts.byDifficulty.high).toEqual({ savingsPct: 2, confidence: 8, gap: 3, noPromotionTarget: 1, budget: 0 });
  });

  it("aggregates primaryBlockerCounts when cheap-first rejected", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: false,
          primaryBlocker: "confidence",
          taskType: "writing",
          difficulty: "high",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
      makeEvent({
        runId: "r2",
        policyEval: {
          usedCheapFirst: false,
          primaryBlocker: "confidence",
          taskType: "writing",
          difficulty: "high",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
      makeEvent({
        runId: "r3",
        policyEval: {
          usedCheapFirst: false,
          primaryBlocker: "savingsPct",
          taskType: "code",
          difficulty: "medium",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.primaryBlockerCounts.totals.confidence).toBe(2);
    expect(out.primaryBlockerCounts.totals.savingsPct).toBe(1);
    expect(out.primaryBlockerCounts.byTaskType.writing.confidence).toBe(2);
    expect(out.primaryBlockerCounts.byTaskType.code.savingsPct).toBe(1);
    expect(out.primaryBlockerCounts.byDifficulty.high.confidence).toBe(2);
    expect(out.primaryBlockerCounts.byDifficulty.medium.savingsPct).toBe(1);
  });

  it("aggregates primaryBlockerCounts when premium_lane", () => {
    const events: RunLogEvent[] = [
      makeEvent({
        runId: "r1",
        policyEval: {
          usedCheapFirst: false,
          primaryBlocker: "premium_lane",
          premiumLane: true,
          premiumTaskType: "writing",
          taskType: "writing",
          difficulty: "high",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
      makeEvent({
        runId: "r2",
        policyEval: {
          usedCheapFirst: false,
          primaryBlocker: "premium_lane",
          premiumLane: true,
          premiumTaskType: "writing",
          taskType: "writing",
          difficulty: "high",
          result: { escalationUsed: false, finalModelId: "gpt-4o" },
        },
      }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.primaryBlockerCounts.totals.premium_lane).toBe(2);
    expect(out.primaryBlockerCounts.byTaskType.writing.premium_lane).toBe(2);
    expect(out.primaryBlockerCounts.byDifficulty.high.premium_lane).toBe(2);
  });

  it("aggregates by taskType and difficulty", () => {
    const events: RunLogEvent[] = [
      makeEvent({ runId: "r1", policyEval: { taskType: "analysis", difficulty: "high" } }),
      makeEvent({ runId: "r2", policyEval: { taskType: "analysis", difficulty: "high" } }),
      makeEvent({ runId: "r3", policyEval: { taskType: "code", difficulty: "medium" } }),
    ];
    const out = aggregatePolicyStats(events);
    expect(out.byTaskType.analysis).toBeDefined();
    expect(out.byTaskType.analysis.runs).toBe(2);
    expect(out.byTaskType.code).toBeDefined();
    expect(out.byTaskType.code.runs).toBe(1);
    expect(out.byDifficulty.high).toBeDefined();
    expect(out.byDifficulty.high.runs).toBe(2);
    expect(out.byDifficulty.medium).toBeDefined();
    expect(out.byDifficulty.medium.runs).toBe(1);
  });
});
