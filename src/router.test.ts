import { describe, it, expect } from "vitest";
import { route, estimateTokensForTask } from "./router.js";
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
