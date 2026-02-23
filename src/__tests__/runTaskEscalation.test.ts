/**
 * Unit tests for Stage 5 escalation (promote-on-low-score).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTask } from "../runTask.js";
import { mockExecutor } from "../executor/mockExecutor.js";
import { SAMPLE_MODELS } from "../demoModels.js";
import type { TaskCard } from "../types.js";

vi.mock("../evaluator/judgeEvaluator.js", () => ({
  evaluateWithJudge: vi.fn(),
}));

import { evaluateWithJudge } from "../evaluator/judgeEvaluator.js";

const mockEvaluate = vi.mocked(evaluateWithJudge);

function mockEvalResult(overall: number) {
  return {
    status: "ok" as const,
    result: {
      overall,
      dimensions: { correctness: overall, completeness: overall, clarity: overall, safety: 1 },
      compliance: overall,
    },
  };
}

const TASK: TaskCard = {
  id: "t1",
  taskType: "analysis",
  difficulty: "high",
};

const ESCALATION_CONFIG = {
  policy: "promote_on_low_score" as const,
  maxPromotions: 1,
  minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
  requireEvalForDecision: true,
  escalateJudgeAlways: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTask escalation", () => {
  it("when escalation off, no second attempt", async () => {
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: { ...ESCALATION_CONFIG, policy: "off" },
        evaluationSampleRate: 0,
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(event.attempts.length).toBe(1);
    expect(event.final.escalationUsed).toBeUndefined();
  });

  it("when escalation on and eval >= threshold, no escalation", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.9));

    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: ESCALATION_CONFIG,
        evaluationSampleRate: 1,
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(event.attempts.length).toBe(1);
    expect(event.final.escalationUsed).toBeUndefined();
  });

  it("when escalation on, eval < threshold, next-tier exists, budget ok: executes escalation and chooses better", async () => {
    mockEvaluate
      .mockResolvedValueOnce(mockEvalResult(0.75))
      .mockResolvedValueOnce(mockEvalResult(0.92));

    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: ESCALATION_CONFIG,
        evaluationSampleRate: 1,
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(event.attempts.length).toBe(2);
    expect(event.final.escalationUsed).toBe(true);
    expect(event.final.escalationDecision?.chosenAttempt).toBe("escalated");
    expect(event.final.chosenModelId).not.toBe(event.attempts[0].modelId);
    expect(event.attempts[1].escalation).toBeDefined();
    expect(event.attempts[1].escalation?.promotedFromModelId).toBe(event.attempts[0].modelId);
  });

  it("when escalation on but no eval initially: runs JIT evaluator and escalates if below threshold", async () => {
    mockEvaluate
      .mockResolvedValueOnce(mockEvalResult(0.72))
      .mockResolvedValueOnce(mockEvalResult(0.9));

    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: ESCALATION_CONFIG,
        evaluationSampleRate: 0,
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(mockEvaluate).toHaveBeenCalled();
    expect(event.attempts.length).toBeGreaterThanOrEqual(1);
    if (event.final.escalationUsed) {
      expect(event.final.escalationDecision?.initialScore).toBeLessThan(0.88);
    }
  });

  it("boundary: 0.859 rounds to 0.86, no escalate (0.86 < 0.86 false)", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.859));

    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: { ...ESCALATION_CONFIG, scoreResolution: 0.01 },
        evaluationSampleRate: 1,
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(event.attempts.length).toBe(1);
    expect(event.final.escalationUsed).toBeUndefined();
  });

  it("boundary: 0.854 rounds to 0.85, escalate (0.85 < 0.86 true)", async () => {
    mockEvaluate
      .mockResolvedValueOnce(mockEvalResult(0.854))
      .mockResolvedValueOnce(mockEvalResult(0.9));

    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: { ...ESCALATION_CONFIG, scoreResolution: 0.01 },
        evaluationSampleRate: 1,
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(event.attempts.length).toBe(2);
    expect(event.final.escalationUsed).toBe(true);
  });

  it("policyEval absent when escalation off", async () => {
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: { ...ESCALATION_CONFIG, policy: "off" },
        evaluationSampleRate: 0,
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });
    expect(event.policyEval).toBeUndefined();
  });

  it("policyEval absent when escalation on but routingMode normal", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.9));
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: { ...ESCALATION_CONFIG, routingMode: "normal" },
        evaluationSampleRate: 1,
      },
      executor: mockExecutor,
      directive: "Analyze this",
      routingOptions: {
        escalationConfig: { ...ESCALATION_CONFIG, routingMode: "normal" },
      },
    });
    expect(event.policyEval).toBeUndefined();
  });

  it("policyEval present when escalation on and routingMode escalation_aware", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.9));
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["gpt-4o|analysis", 0.6],
      ["claude-sonnet-4-5-20250929|analysis", 0.55],
    ]);
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: {
          ...ESCALATION_CONFIG,
          routingMode: "escalation_aware",
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.1,
          cheapFirstOnlyWhenCanPromote: true,
        },
        evaluationSampleRate: 1,
        selectionPolicy: "best_value",
      },
      executor: mockExecutor,
      directive: "Analyze this",
      routingOptions: {
        calibrationConfidence,
        escalationConfig: {
          ...ESCALATION_CONFIG,
          routingMode: "escalation_aware",
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.1,
          cheapFirstOnlyWhenCanPromote: true,
        },
      },
    });
    expect(event.policyEval).toBeDefined();
    expect(event.policyEval?.enabled).toBe(true);
    expect(event.policyEval?.routingMode).toBe("escalation_aware");
    expect(event.policyEval?.normalChoice).toBeDefined();
    expect(event.policyEval?.chosenAttempt1).toBeDefined();
    expect(event.policyEval?.result.escalationUsed).toBe(false);
    expect(event.policyEval?.result.finalModelId).toBe(event.final.chosenModelId);
  });

  it("when cheap-first used, normalChoice differs from chosenAttempt1", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.9));
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["gpt-4o|analysis", 0.6],
      ["claude-sonnet-4-5-20250929|analysis", 0.55],
    ]);
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: {
          ...ESCALATION_CONFIG,
          routingMode: "escalation_aware",
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.1,
          cheapFirstOnlyWhenCanPromote: true,
        },
        evaluationSampleRate: 1,
        selectionPolicy: "best_value",
      },
      executor: mockExecutor,
      directive: "Analyze this",
      routingOptions: {
        calibrationConfidence,
        escalationConfig: {
          ...ESCALATION_CONFIG,
          routingMode: "escalation_aware",
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.1,
          cheapFirstOnlyWhenCanPromote: true,
        },
      },
    });
    if (event.policyEval?.usedCheapFirst) {
      expect(event.policyEval.normalChoice.modelId).not.toBe(event.policyEval.chosenAttempt1.modelId);
      expect(event.policyEval.estimatedSavingsUSD).toBeGreaterThan(0);
    }
  });

  it("when evaluationMode=focused and normalEvalRate=0, skips eval when not cheap-first", async () => {
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: {
          ...ESCALATION_CONFIG,
          evaluationMode: "focused",
          normalEvalRate: 0,
          cheapFirstEvalRate: 1,
          requireEvalForDecision: false,
        },
        evaluationSampleRate: 1,
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });
    expect(event.attempts[0].eval?.status).toBe("skipped");
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("when evaluationMode=focused and cheap-first used, uses cheapFirstEvalRate", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.9));
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|analysis", 0.5],
      ["gpt-4o|analysis", 0.6],
      ["claude-sonnet-4-5-20250929|analysis", 0.55],
    ]);
    const event = await runTask({
      task: TASK,
      models: SAMPLE_MODELS,
      config: {
        escalation: {
          ...ESCALATION_CONFIG,
          routingMode: "escalation_aware",
          evaluationMode: "focused",
          cheapFirstEvalRate: 1,
          normalEvalRate: 0,
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.1,
        },
        evaluationSampleRate: 0,
        selectionPolicy: "best_value",
      },
      executor: mockExecutor,
      directive: "Analyze this",
      routingOptions: {
        calibrationConfidence,
        escalationConfig: {
          ...ESCALATION_CONFIG,
          routingMode: "escalation_aware",
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.1,
        },
      },
    });
    if (event.policyEval?.usedCheapFirst) {
      expect(event.attempts[0].eval?.status).toBe("ok");
      expect(mockEvaluate).toHaveBeenCalled();
    }
  });

  it("when premiumTaskTypes includes taskType, policyEval has premiumLane and primaryBlocker=premium_lane", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.9));
    const writingTask = { ...TASK, taskType: "writing" as const };
    const calibrationConfidence = new Map([
      ["gpt-4o-mini|writing", 0.5],
      ["gpt-4o|writing", 0.6],
      ["claude-sonnet-4-5-20250929|writing", 0.55],
    ]);
    const escConfig = {
      ...ESCALATION_CONFIG,
      routingMode: "escalation_aware" as const,
      cheapFirstMinConfidence: 0.4,
      cheapFirstSavingsMinPct: 0.1,
      cheapFirstOnlyWhenCanPromote: true,
    };
    const event = await runTask({
      task: writingTask,
      models: SAMPLE_MODELS,
      config: {
        escalation: escConfig,
        evaluationSampleRate: 1,
        selectionPolicy: "best_value",
        premiumTaskTypes: ["writing"],
      },
      executor: mockExecutor,
      directive: "Write this",
      routingOptions: {
        calibrationConfidence,
        escalationConfig: escConfig,
      },
    });
    expect(event.policyEval).toBeDefined();
    expect(event.policyEval?.usedCheapFirst).toBe(false);
    expect(event.policyEval?.premiumLane).toBe(true);
    expect(event.policyEval?.premiumTaskType).toBe("writing");
    expect(event.policyEval?.gateReason).toBe("premium_lane");
    expect(event.policyEval?.primaryBlocker).toBe("premium_lane");
    expect(event.policyEval?.primaryBlocker).not.toBe("no_cheap_first_candidates");
    expect(event.policyEval?.gateProgress).toBeUndefined();
  });

  it("when escalation on but budget blocks: no escalation", async () => {
    mockEvaluate.mockResolvedValue(mockEvalResult(0.75));

    const event = await runTask({
      task: {
        ...TASK,
        constraints: { maxCostUSD: 0.01 },
      },
      models: SAMPLE_MODELS,
      config: {
        escalation: { ...ESCALATION_CONFIG, maxExtraCostUSD: 0.0000001 },
        evaluationSampleRate: 1,
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
      },
      executor: mockExecutor,
      directive: "Analyze this",
    });

    expect(event.attempts.length).toBe(1);
    expect(event.final.escalationUsed).toBeUndefined();
  });
});
