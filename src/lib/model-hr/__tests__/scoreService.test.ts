import { describe, it, expect } from "vitest";
import { ScoreService } from "../scoring/scoreService.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import {
  FIXTURE_MODEL_ACTIVE,
  FIXTURE_MODEL_DISABLED,
  FIXTURE_MODEL_DEPRECATED,
  FIXTURE_MODEL_PROBATION,
  FIXTURE_MODELS,
  FIXTURE_MODEL_GPT4O_MINI,
} from "./fixtures.js";
import type { ModelPerformancePrior } from "../types.js";

async function createScoreService(priorsByModel?: Record<string, ModelPerformancePrior[]>) {
  const storage = new InMemoryStorageAdapter(FIXTURE_MODELS);
  if (priorsByModel) {
    for (const [modelId, priors] of Object.entries(priorsByModel)) {
      await storage.savePriors(modelId, priors);
    }
  }
  const registry = new RegistryService(storage);
  return new ScoreService(registry);
}

const BASE_CTX = {
  taskType: "code",
  difficulty: "medium",
  tierProfile: "standard" as const,
  budgetRemaining: 1,
};

describe("ScoreService.computeModelScore", () => {
  it("disabled => score 0", async () => {
    const scoreService = await createScoreService();
    const score = await scoreService.computeModelScore(FIXTURE_MODEL_DISABLED, BASE_CTX);
    expect(score).toBe(0);
  });

  it("probation => score penalized", async () => {
    const scoreService = await createScoreService();
    const activeScore = await scoreService.computeModelScore(FIXTURE_MODEL_ACTIVE, BASE_CTX);
    const probationScore = await scoreService.computeModelScore(FIXTURE_MODEL_PROBATION, BASE_CTX);
    expect(probationScore).toBeLessThan(activeScore);
    expect(probationScore).toBeGreaterThanOrEqual(0);
  });

  it("deprecated => score penalized", async () => {
    const lowBaseModel = {
      ...FIXTURE_MODEL_ACTIVE,
      id: "low-base",
      reliability: 0.5,
      expertise: { code: 0.5, general: 0.5 },
    };
    const deprecatedLowBase = {
      ...lowBaseModel,
      id: "deprecated-low",
      identity: { ...lowBaseModel.identity, status: "deprecated" as const },
    };
    const activeLowBase = {
      ...lowBaseModel,
      id: "active-low",
      identity: { ...lowBaseModel.identity, status: "active" as const },
    };
    const storage = new InMemoryStorageAdapter([activeLowBase, deprecatedLowBase] as any);
    const registry = new RegistryService(storage);
    const scoreService = new ScoreService(registry);

    const activeScore = await scoreService.computeModelScore(activeLowBase, BASE_CTX);
    const deprecatedScore = await scoreService.computeModelScore(deprecatedLowBase, BASE_CTX);
    expect(deprecatedScore).toBeLessThan(activeScore);
    expect(deprecatedScore).toBeGreaterThanOrEqual(0);
  });

  it("cost penalty applies when adjusted cost > tier threshold", async () => {
    const highCostPrior: ModelPerformancePrior = {
      taskType: "code",
      difficulty: "medium",
      qualityPrior: 0.5,
      costMultiplier: 20,
      calibrationConfidence: 0.8,
      lastUpdatedISO: "2025-01-15T12:00:00.000Z",
      sampleCount: 50,
    };
    const lowCostPrior: ModelPerformancePrior = {
      ...highCostPrior,
      costMultiplier: 0.05,
    };
    const baseModel = {
      ...FIXTURE_MODEL_ACTIVE,
      reliability: 0.6,
      expertise: { code: 0.6, general: 0.6 },
    };
    const highCostModel = { ...baseModel, id: "high-cost" };
    const lowCostModel = { ...baseModel, id: "low-cost" };
    const storage = new InMemoryStorageAdapter([highCostModel, lowCostModel] as any);
    await storage.savePriors("high-cost", [highCostPrior]);
    await storage.savePriors("low-cost", [lowCostPrior]);
    const registry = new RegistryService(storage);
    const scoreService = new ScoreService(registry);

    const highScore = await scoreService.computeModelScore(highCostModel, BASE_CTX);
    const lowScore = await scoreService.computeModelScore(lowCostModel, BASE_CTX);
    expect(highScore).toBeLessThan(lowScore);
  });

  it("uses expertise and reliability and priors when present", async () => {
    const prior: ModelPerformancePrior = {
      taskType: "code",
      difficulty: "medium",
      qualityPrior: 0.95,
      costMultiplier: 1,
      calibrationConfidence: 0.9,
      lastUpdatedISO: "2025-01-15T12:00:00.000Z",
      sampleCount: 100,
    };
    const scoreService = await createScoreService({ [FIXTURE_MODEL_ACTIVE.id]: [prior] });
    const ctxPremium = { ...BASE_CTX, tierProfile: "premium" as const };
    const score = await scoreService.computeModelScore(FIXTURE_MODEL_ACTIVE, ctxPremium);
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThanOrEqual(1);
  });

  describe("computeModelScoreWithBreakdown", () => {
    it("breakdown includes statusPenalty for probation", async () => {
      const scoreService = await createScoreService();
      const { score, breakdown } = await scoreService.computeModelScoreWithBreakdown(
        FIXTURE_MODEL_PROBATION,
        BASE_CTX
      );
      expect(breakdown.statusPenalty).toBe(0.15);
      expect(breakdown.finalScore).toBe(score);
      expect(score).toBeLessThan(
        await scoreService.computeModelScore(
          { ...FIXTURE_MODEL_PROBATION, identity: { ...FIXTURE_MODEL_PROBATION.identity, status: "active" } } as any,
          BASE_CTX
        )
      );
    });

    it("breakdown includes statusPenalty for deprecated", async () => {
      const deprecated = { ...FIXTURE_MODEL_ACTIVE, identity: { ...FIXTURE_MODEL_ACTIVE.identity, status: "deprecated" as const } };
      const scoreService = await createScoreService();
      const { breakdown } = await scoreService.computeModelScoreWithBreakdown(deprecated as any, BASE_CTX);
      expect(breakdown.statusPenalty).toBe(0.1);
    });

    it("breakdown includes costPenalty when adjusted cost exceeds tier threshold", async () => {
      const highCostPrior: ModelPerformancePrior = {
        taskType: "code",
        difficulty: "medium",
        qualityPrior: 0.8,
        costMultiplier: 10,
        calibrationConfidence: 0.8,
        lastUpdatedISO: "2025-01-15T12:00:00.000Z",
        sampleCount: 50,
      };
      const model = { ...FIXTURE_MODEL_ACTIVE, id: "high-cost" };
      const storage = new InMemoryStorageAdapter([model] as any);
      await storage.savePriors("high-cost", [highCostPrior]);
      const registry = new RegistryService(storage);
      const scoreService = new ScoreService(registry);

      const { breakdown } = await scoreService.computeModelScoreWithBreakdown(model as any, BASE_CTX);
      expect(breakdown.costPenalty).toBeGreaterThan(0);
      expect(breakdown.adjustedCostUSD).toBeGreaterThan(0.0015);
      const rawSum =
        breakdown.baseReliability +
        breakdown.expertiseComponent +
        breakdown.priorQualityComponent -
        breakdown.statusPenalty -
        breakdown.costPenalty;
      expect(breakdown.finalScore).toBe(Math.max(0, Math.min(1, rawSum)));
    });

    it("gpt-4o scores higher than gpt-4o-mini for strategy/code/medium under premium tier", async () => {
      const storage = new InMemoryStorageAdapter([FIXTURE_MODEL_ACTIVE, FIXTURE_MODEL_GPT4O_MINI] as any);
      const registry = new RegistryService(storage);
      const scoreService = new ScoreService(registry);
      const ctx = {
        taskType: "strategy",
        difficulty: "medium",
        tierProfile: "premium" as const,
        budgetRemaining: 1,
      };
      const gpt4oScore = await scoreService.computeModelScore(FIXTURE_MODEL_ACTIVE, ctx);
      const gpt4oMiniScore = await scoreService.computeModelScore(FIXTURE_MODEL_GPT4O_MINI, ctx);
      expect(gpt4oScore).toBeGreaterThan(gpt4oMiniScore);
    });

    it("gpt-4o-mini scores higher than gpt-4o for writing/low under cheap tier when both pass", async () => {
      const storage = new InMemoryStorageAdapter([FIXTURE_MODEL_ACTIVE, FIXTURE_MODEL_GPT4O_MINI] as any);
      const registry = new RegistryService(storage);
      const scoreService = new ScoreService(registry);
      const ctx = {
        taskType: "writing",
        difficulty: "low",
        tierProfile: "cheap" as const,
        budgetRemaining: 1,
      };
      const gpt4oScore = await scoreService.computeModelScore(FIXTURE_MODEL_ACTIVE, ctx);
      const gpt4oMiniScore = await scoreService.computeModelScore(FIXTURE_MODEL_GPT4O_MINI, ctx);
      expect(gpt4oMiniScore).toBeGreaterThan(gpt4oScore);
    });

    it("breakdown math: finalScore = base + expertise + prior - costPenalty - statusPenalty", async () => {
      const prior: ModelPerformancePrior = {
        taskType: "code",
        difficulty: "medium",
        qualityPrior: 0.7,
        costMultiplier: 1,
        calibrationConfidence: 0.8,
        lastUpdatedISO: "2025-01-15T12:00:00.000Z",
        sampleCount: 30,
      };
      const scoreService = await createScoreService({ [FIXTURE_MODEL_ACTIVE.id]: [prior] });
      const { score, breakdown } = await scoreService.computeModelScoreWithBreakdown(
        FIXTURE_MODEL_ACTIVE,
        BASE_CTX
      );
      const expected =
        breakdown.baseReliability +
        breakdown.expertiseComponent +
        breakdown.priorQualityComponent -
        breakdown.costPenalty -
        breakdown.statusPenalty;
      expect(breakdown.finalScore).toBeCloseTo(Math.max(0, Math.min(1, expected)), 5);
      expect(score).toBe(breakdown.finalScore);
    });
  });
});
