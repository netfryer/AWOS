import { describe, it, expect } from "vitest";
import { route, estimateTokensForTask, computeNormalChoice, type PriorForQualification } from "./router.js";
import type { TaskCard, ModelSpec } from "./types.js";

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
  taskType: "code",
  difficulty: "medium",
};

describe("router.route with enforceCheapestViable (cheapestViableChosen)", () => {
  const models: ModelSpec[] = [
    makeModel("cheap", 0.001, 0.002, 0.85),
    makeModel("medium", 0.002, 0.004, 0.85),
    makeModel("expensive", 0.003, 0.006, 0.85),
  ];

  it("when enforceCheapestViable true, picks cheapest among passed candidates", () => {
    const scores = new Map<string, number>([
      ["cheap", 0.7],
      ["medium", 0.9],
      ["expensive", 0.95],
    ]);
    const result = route(TASK, models, undefined, undefined, undefined, {
      candidateScores: scores,
      cheapestViableChosen: true,
    });
    expect(result.chosenModelId).toBe("cheap");
    expect(result.routingAudit?.enforceCheapestViable).toBe(true);
    expect(result.routingAudit?.chosenIsCheapestViable).toBe(true);
    expect(result.routingAudit?.rankedBy).toBe("cheapest_viable");
  });

  it("when enforceCheapestViable false and scores exist, picks best score desc then cost asc", () => {
    const scores = new Map<string, number>([
      ["cheap", 0.7],
      ["medium", 0.9],
      ["expensive", 0.95],
    ]);
    const result = route(TASK, models, undefined, undefined, undefined, {
      candidateScores: scores,
      cheapestViableChosen: false,
    });
    expect(result.chosenModelId).toBe("expensive");
    expect(result.routingAudit?.enforceCheapestViable).toBe(false);
    expect(result.routingAudit?.rankedBy).toBe("score");
  });

  it("when scores tie, picks cheaper (cost asc)", () => {
    const scores = new Map<string, number>([
      ["cheap", 0.9],
      ["medium", 0.9],
      ["expensive", 0.9],
    ]);
    const result = route(TASK, models, undefined, undefined, undefined, {
      candidateScores: scores,
      cheapestViableChosen: false,
    });
    expect(result.chosenModelId).toBe("cheap");
    expect(result.routingAudit?.rankedBy).toBe("score");
  });
});

describe("route with priorsByModel (effectiveQuality for qualification)", () => {
  const TASK_MEDIUM: TaskCard = {
    id: "t1",
    taskType: "code",
    difficulty: "medium",
  };
  const threshold = 0.8;

  it("model with static expertise below threshold but prior.qualityPrior above threshold is NOT filtered out", () => {
    const lowExpertiseModel = makeModel("low-exp", 0.001, 0.002, 0.65);
    const priorsByModel = new Map<string, PriorForQualification[]>([
      [
        "low-exp",
        [{ taskType: "code", difficulty: "medium", qualityPrior: 0.9 }],
      ],
    ]);
    const result = route(TASK_MEDIUM, [lowExpertiseModel], undefined, undefined, undefined, {
      priorsByModel,
    });
    expect(result.chosenModelId).toBe("low-exp");
    expect(result.status).toBe("ok");
  });

  it("if no prior exists, behavior matches old logic (expertise only)", () => {
    const lowExpertiseModel = makeModel("low-exp", 0.001, 0.002, 0.65);
    const highExpertiseModel = makeModel("high-exp", 0.002, 0.004, 0.85);
    const result = route(TASK_MEDIUM, [lowExpertiseModel, highExpertiseModel], undefined, undefined, undefined);
    expect(result.chosenModelId).toBe("high-exp");
  });

  it("model with low expertise and empty prior array uses expertise (fallback); high-expertise model chosen", () => {
    const lowExpertiseModel = makeModel("low-exp", 0.001, 0.002, 0.65);
    const highExpertiseModel = makeModel("high-exp", 0.002, 0.004, 0.85);
    const priorsByModel = new Map<string, PriorForQualification[]>([
      ["low-exp", []],
    ]);
    const result = route(TASK_MEDIUM, [lowExpertiseModel, highExpertiseModel], undefined, undefined, undefined, {
      priorsByModel,
    });
    expect(result.chosenModelId).toBe("high-exp");
  });

  it("prior with matching taskType/difficulty used; mismatched prior falls back to expertise", () => {
    const model = makeModel("m1", 0.001, 0.002, 0.65);
    const priorsByModel = new Map<string, PriorForQualification[]>([
      [
        "m1",
        [
          { taskType: "writing", difficulty: "medium", qualityPrior: 0.9 },
          { taskType: "code", difficulty: "medium", qualityPrior: 0.9 },
        ],
      ],
    ]);
    const result = route(TASK_MEDIUM, [model], undefined, undefined, undefined, {
      priorsByModel,
    });
    expect(result.chosenModelId).toBe("m1");
  });
});

describe("route with best_value and guardrails", () => {
  const models: ModelSpec[] = [
    makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.78),
    makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    makeModel("claude-sonnet", 0.003, 0.015, 0.85),
  ];
  const calibrationConfidence = new Map<string, number>([
    ["gpt-4o-mini|code", 0.5],
    ["gpt-4o|code", 0.6],
    ["claude-sonnet|code", 0.55],
  ]);
  const task: TaskCard = { id: "t1", taskType: "code", difficulty: "medium" };
  const config = {
    selectionPolicy: "best_value" as const,
    noQualifiedPolicy: "best_value_near_threshold" as const,
    thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
  };

  it("best_value chooses gpt-4o-mini for code/medium/fast (good value score)", () => {
    const result = route(task, models, config, undefined, undefined, {
      calibrationConfidence,
    });
    expect(result.chosenModelId).toBe("gpt-4o-mini");
    expect(result.routingAudit?.rankedBy).toBe("best_value");
    expect(result.rationale).toContain("best_value");
  });

  it("audit entries show rawConfidence, effectiveConfidence, minBenefitRequired", () => {
    const result = route(task, models, config, undefined, undefined, {
      calibrationConfidence,
    });
    const miniAudit = result.routingAudit?.candidates.find((c) => c.modelId === "gpt-4o-mini");
    expect(miniAudit?.rawConfidence).toBeDefined();
    expect(miniAudit?.effectiveConfidence).toBeDefined();
    expect(miniAudit?.minConfidenceToUseCalibration).toBeDefined();
    expect(miniAudit?.minBenefitRequired).toBeDefined();
    expect(miniAudit?.valueScoreEntry).toBeDefined();
  });

  it("falls back to highest expertise when all excluded by minBenefit", () => {
    const lowBenefitModels: ModelSpec[] = [
      makeModel("barely-qual", 0.001, 0.002, 0.801),
      makeModel("also-barely", 0.001, 0.002, 0.802),
    ];
    const result = route(
      task,
      lowBenefitModels,
      { ...config, thresholds: { low: 0.7, medium: 0.8, high: 0.88 }, minBenefitByDifficulty: { low: 0, medium: 0.05, high: 0.1 } },
      undefined,
      undefined,
      {
        calibrationConfidence: new Map([["barely-qual|code", 0.5], ["also-barely|code", 0.5]]),
      }
    );
    expect(result.chosenModelId).toBeDefined();
    expect(result.rationale).toContain("minBenefit");
    expect(result.rationale).toContain("Fallback to highest expertise");
  });
});

describe("estimateTokensForTask", () => {
  const task: TaskCard = { id: "t1", taskType: "code", difficulty: "medium" };

  it("uses fallback when directive is short (< 800 total tokens)", () => {
    const short = "Implement CSV parser";
    const out = estimateTokensForTask(task, short);
    const total = out.input + out.output;
    expect(total).toBeGreaterThanOrEqual(800);
    expect(out.input).toBeGreaterThanOrEqual(500);
    expect(out.output).toBeGreaterThanOrEqual(300);
  });

  it("uses directive-based estimate when directive is long enough", () => {
    const long = "x".repeat(4000);
    const out = estimateTokensForTask(task, long);
    const total = out.input + out.output;
    expect(total).toBeGreaterThanOrEqual(800);
    expect(out.input).toBeLessThanOrEqual(6000);
    expect(out.output).toBeLessThanOrEqual(2500);
  });
});

describe("computeNormalChoice (Stage 5.3)", () => {
  const task: TaskCard = { id: "t1", taskType: "analysis", difficulty: "high" };
  const config = { thresholds: { low: 0.7, medium: 0.8, high: 0.85 } };

  it("returns normal choice (no escalation-aware); uses same selectionPolicy as route", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.78),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const routingOptions = {
      calibrationConfidence: new Map([["gpt-4o-mini|analysis", 0.5], ["gpt-4o|analysis", 0.6]]),
      escalationConfig: { policy: "promote_on_low_score" as const, maxPromotions: 1, minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 }, routingMode: "escalation_aware" as const },
    };
    const normal = computeNormalChoice(task, models, config, undefined, routingOptions);
    expect(normal).not.toBeNull();
    expect(normal!.modelId).toBe("gpt-4o");
    expect(normal!.expectedCostUSD).toBeGreaterThan(0);
    expect(normal!.threshold).toBe(0.85);
    expect(normal!.expertise).toBe(0.92);
  });

  it("route with escalation_aware can pick cheap-first; normalChoice differs", () => {
    const models: ModelSpec[] = [
      makeModel("gpt-4o-mini", 0.00015, 0.0006, 0.86),
      makeModel("gpt-4o", 0.0025, 0.01, 0.92),
    ];
    const routingOptions = {
      calibrationConfidence: new Map([["gpt-4o-mini|analysis", 0.5], ["gpt-4o|analysis", 0.6]]),
      escalationConfig: { policy: "promote_on_low_score" as const, maxPromotions: 1, minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 }, routingMode: "escalation_aware" as const },
    };
    const routeResult = route(task, models, { ...config, selectionPolicy: "best_value", escalation: routingOptions.escalationConfig }, undefined, undefined, routingOptions);
    const normal = computeNormalChoice(task, models, { ...config, selectionPolicy: "best_value" }, undefined, routingOptions);
    expect(normal).not.toBeNull();
    if (routeResult.chosenModelId === "gpt-4o-mini" && normal!.modelId === "gpt-4o") {
      expect(normal!.expectedCostUSD).toBeGreaterThan(routeResult.expectedCostUSD ?? 0);
    }
  });
});
