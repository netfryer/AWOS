/**
 * Unit tests for Stage 5.2 escalation-aware routing.
 */

import { describe, it, expect } from "vitest";
import { route } from "../router.js";
import type { TaskCard, ModelSpec } from "../types.js";

function makeModel(id: string, inPer1k: number, outPer1k: number, expertise: number): ModelSpec {
  return {
    id,
    displayName: id,
    expertise: { code: expertise, writing: expertise, analysis: expertise, general: expertise },
    pricing: { inPer1k, outPer1k },
    reliability: 0.9,
  };
}

const TASK: TaskCard = {
  id: "t1",
  taskType: "analysis",
  difficulty: "high",
};

describe("escalation-aware routing", () => {
  it("when escalation off, route unchanged", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.78),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.enabled).toBeFalsy();
  });

  it("when escalation on but routingMode normal, route unchanged", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.78),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "normal",
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "normal",
      },
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.enabled).toBe(false);
    expect(result.routingAudit?.escalationAware?.reason).toBe("escalation_aware_disabled");
  });

  it("when escalationAware enabled and cheaper qualified candidate with promotion target, picks cheap-first", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("claude-sonnet-4-5-20250929", 0.003, 0.015, 0.88),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["claude-sonnet-4-5-20250929|analysis", 0.55],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.1,
        cheapFirstOnlyWhenCanPromote: true,
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.1,
        cheapFirstOnlyWhenCanPromote: true,
      },
    });
    expect(result.routingAudit?.rankedBy).toBe("escalation_aware");
    expect(result.routingAudit?.escalationAware?.cheapFirstChoice).toBeDefined();
    expect(result.chosenModelId).toBe("gpt-4o-mini");
    expect(result.rationale).toContain("Escalation-aware");
  });

  it("when cheaper candidate exists but confidence < cheapFirstMinConfidence, rejected", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.3],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
      },
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.reason).toContain("rejected");
  });

  it("when cheaper candidate exists but no promotion target, rejected (cheapFirstOnlyWhenCanPromote)", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([["gpt-4o|analysis", 0.6]]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstOnlyWhenCanPromote: true,
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstOnlyWhenCanPromote: true,
      },
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.cheapFirstChoice).toBeUndefined();
  });

  it("uses cheapFirstMaxGapByTaskType override for writing when gap exceeds default", () => {
    const writingTask: TaskCard = { ...TASK, taskType: "writing" };
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.74),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|writing", 0.5],
      ["gpt-4o|writing", 0.6],
    ]);
    const escConfig = {
      policy: "promote_on_low_score" as const,
      maxPromotions: 1,
      minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
      routingMode: "escalation_aware" as const,
      cheapFirstMinConfidence: 0.4,
      cheapFirstSavingsMinPct: 0.1,
      cheapFirstMaxGapByDifficulty: { low: 0.06, medium: 0.08, high: 0.1 },
      cheapFirstMaxGapByTaskType: { writing: { high: 0.12 } },
      cheapFirstOnlyWhenCanPromote: true,
    };
    const result = route(writingTask, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: escConfig,
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: escConfig,
    });
    expect(result.chosenModelId).toBe("gpt-4o-mini");
    expect(result.routingAudit?.escalationAware?.cheapFirstChoice).toBeDefined();
    expect(result.routingAudit?.escalationAware?.maxGap).toBe(0.12);
  });

  it("when budget cannot cover worst-case, cheap-first rejected", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(
      { ...TASK, constraints: { maxCostUSD: 0.001 } },
      models,
      {
        thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
        selectionPolicy: "best_value",
        escalation: {
          policy: "promote_on_low_score",
          maxPromotions: 1,
          minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
          routingMode: "escalation_aware",
          cheapFirstBudgetHeadroomFactor: 1.1,
        },
      },
      undefined,
      undefined,
      {
        calibrationConfidence,
        escalationConfig: {
          policy: "promote_on_low_score",
          maxPromotions: 1,
          minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
          routingMode: "escalation_aware",
          cheapFirstBudgetHeadroomFactor: 1.1,
        },
      }
    );
    expect(result.chosenModelId).toBe("gpt-4o-mini");
    expect(result.routingAudit?.escalationAware?.cheapFirstChoice).toBeUndefined();
    expect(result.routingAudit?.escalationAware?.primaryBlocker).toBe("no_cheap_first_candidates");
  });

  it("uses cheapFirstOverridesByTaskType to lower minConfidence for writing", () => {
    const writingTask: TaskCard = { ...TASK, taskType: "writing" };
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|writing", 0.35],
      ["gpt-4o|writing", 0.6],
    ]);
    const escConfig = {
      policy: "promote_on_low_score" as const,
      maxPromotions: 1,
      minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
      routingMode: "escalation_aware" as const,
      cheapFirstMinConfidence: 0.4,
      cheapFirstSavingsMinPct: 0.1,
      cheapFirstOverridesByTaskType: { writing: { minConfidence: 0.25 } },
      cheapFirstOnlyWhenCanPromote: true,
    };
    const result = route(writingTask, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: escConfig,
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: escConfig,
    });
    expect(result.chosenModelId).toBe("gpt-4o-mini");
    expect(result.routingAudit?.escalationAware?.cheapFirstChoice).toBeDefined();
  });

  it("sets primaryBlocker=confidence when savings passes but confidence eliminates all", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.35],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.1,
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.1,
      },
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.primaryBlocker).toBe("confidence");
    expect(result.routingAudit?.escalationAware?.gateProgress?.afterSavings).toBeGreaterThan(0);
    expect(result.routingAudit?.escalationAware?.gateProgress?.afterConfidence).toBe(0);
  });

  it("sets primaryBlocker=no_cheap_first_candidates when no model passes savings", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.002, 0.01, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.5,
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.5,
      },
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.primaryBlocker).toBe("no_cheap_first_candidates");
    expect(result.routingAudit?.escalationAware?.gateProgress?.afterSavings).toBe(0);
  });

  it("when taskType in premiumTaskTypes, uses normal choice and audit has premiumLane=true", () => {
    const writingTask: TaskCard = { id: "t1", taskType: "writing", difficulty: "high" };
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|writing", 0.5],
      ["gpt-4o|writing", 0.6],
    ]);
    const escConfig = {
      policy: "promote_on_low_score" as const,
      maxPromotions: 1,
      minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
      routingMode: "escalation_aware" as const,
      cheapFirstMinConfidence: 0.4,
      cheapFirstSavingsMinPct: 0.1,
      cheapFirstOnlyWhenCanPromote: true,
    };
    const result = route(writingTask, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: escConfig,
      premiumTaskTypes: ["writing"],
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: escConfig,
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.normalChoice.modelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.premiumLane).toBe(true);
    expect(result.routingAudit?.escalationAware?.premiumLaneReason).toContain("writing");
    expect(result.routingAudit?.escalationAware?.cheapFirstChoice).toBeUndefined();
  });

  it("populates gateRejectionCounts when no cheap-first candidates (confidence blocks)", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.35],
      ["gpt-4o|analysis", 0.6],
    ]);
    const result = route(TASK, models, {
      thresholds: { low: 0.7, medium: 0.8, high: 0.85 },
      selectionPolicy: "best_value",
      escalation: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.1,
      },
    }, undefined, undefined, {
      calibrationConfidence,
      escalationConfig: {
        policy: "promote_on_low_score",
        maxPromotions: 1,
        minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
        routingMode: "escalation_aware",
        cheapFirstMinConfidence: 0.4,
        cheapFirstSavingsMinPct: 0.1,
      },
    });
    expect(result.chosenModelId).toBe("gpt-4o");
    expect(result.routingAudit?.escalationAware?.gateRejectionCounts).toBeDefined();
    expect(result.routingAudit?.escalationAware?.gateRejectionCounts?.confidence).toBeGreaterThan(0);
  });
});
