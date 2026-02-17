import { describe, it, expect } from "vitest";
import { EvaluationService } from "../evaluation/evaluationService.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import { makeObservation, makeObservations } from "./fixtures.js";
import type { ModelRegistryEntry } from "../types.js";

const now = "2025-01-15T12:00:00.000Z";

const MODEL_FOR_PRIORS: ModelRegistryEntry = {
  id: "model-priors-test",
  identity: {
    provider: "openai",
    modelId: "model-priors-test",
    status: "active",
  },
  displayName: "Priors Test",
  pricing: { inPer1k: 0.001, outPer1k: 0.002, currency: "USD" },
  expertise: { general: 0.8 },
  reliability: 0.85,
  createdAtISO: now,
  updatedAtISO: now,
};

describe("EvaluationService.updatePriors", () => {
  it("computes qualityPrior = avg(actualQuality) clamped", async () => {
    const obs = [
      makeObservation("m1", { actualQuality: 0.8, predictedCostUSD: 0.01, actualCostUSD: 0.01 }),
      makeObservation("m1", { actualQuality: 0.9, predictedCostUSD: 0.01, actualCostUSD: 0.01 }),
      makeObservation("m1", { actualQuality: 0.7, predictedCostUSD: 0.01, actualCostUSD: 0.01 }),
    ].map((o) => ({ ...o, taskType: "code", difficulty: "medium" }));
    const storage = new InMemoryStorageAdapter([{ ...MODEL_FOR_PRIORS, id: "m1" }]);
    storage.seedObservations("m1", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const prior = await evalSvc.updatePriors("m1", "code", "medium");
    expect(prior).not.toBeNull();
    expect(prior!.qualityPrior).toBeCloseTo(0.8, 2);
  });

  it("computes costMultiplier = avg(actualCostUSD / predictedCostUSD) clamped", async () => {
    const obs = [
      makeObservation("m2", { actualCostUSD: 0.02, predictedCostUSD: 0.01, actualQuality: 0.8 }),
      makeObservation("m2", { actualCostUSD: 0.03, predictedCostUSD: 0.01, actualQuality: 0.8 }),
    ].map((o) => ({ ...o, taskType: "code", difficulty: "medium" }));
    const storage = new InMemoryStorageAdapter([{ ...MODEL_FOR_PRIORS, id: "m2" }]);
    storage.seedObservations("m2", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const prior = await evalSvc.updatePriors("m2", "code", "medium");
    expect(prior).not.toBeNull();
    expect(prior!.costMultiplier).toBeCloseTo(2.5, 1);
  });

  it("computes varianceBandLow/high = 20th/80th percentile", async () => {
    const ratios = [0.5, 1, 1.5, 2, 2.5];
    const obs = ratios.map((r, i) =>
      makeObservation("m3", {
        actualCostUSD: r * 0.01,
        predictedCostUSD: 0.01,
        actualQuality: 0.8,
        tsISO: new Date(Date.now() - i * 1000).toISOString(),
      })
    ).map((o) => ({ ...o, taskType: "code", difficulty: "medium" }));
    const storage = new InMemoryStorageAdapter([{ ...MODEL_FOR_PRIORS, id: "m3" }]);
    storage.seedObservations("m3", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const prior = await evalSvc.updatePriors("m3", "code", "medium");
    expect(prior).not.toBeNull();
    expect(prior!.varianceBandLow).toBeDefined();
    expect(prior!.varianceBandHigh).toBeDefined();
    expect(prior!.varianceBandLow!).toBeLessThanOrEqual(prior!.varianceBandHigh!);
  });

  it("calibrationConfidence scales with sampleCount", async () => {
    const obsFew = makeObservations("m4a", 10, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.8,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const obsMany = makeObservations("m4b", 80, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.8,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const storage = new InMemoryStorageAdapter([
      { ...MODEL_FOR_PRIORS, id: "m4a" },
      { ...MODEL_FOR_PRIORS, id: "m4b" },
    ]);
    storage.seedObservations("m4a", obsFew);
    storage.seedObservations("m4b", obsMany);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const priorFew = await evalSvc.updatePriors("m4a", "code", "medium");
    const priorMany = await evalSvc.updatePriors("m4b", "code", "medium");
    expect(priorFew!.calibrationConfidence).toBeLessThan(priorMany!.calibrationConfidence);
  });

  it("probation rule: sampleCount>=30 and qualityPrior<0.55 -> probation", async () => {
    const obs = makeObservations("m5", 35, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.5,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const model: ModelRegistryEntry = {
      ...MODEL_FOR_PRIORS,
      id: "m5",
      identity: { ...MODEL_FOR_PRIORS.identity, status: "active" },
    };
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("m5", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("m5", "code", "medium");
    const updated = await registry.getModel("m5");
    expect(updated).not.toBeNull();
    expect(updated!.identity.status).toBe("probation");
  });

  it("graduation rule: sampleCount>=50 and qualityPrior>=0.75 -> active", async () => {
    const obs = makeObservations("m6", 55, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.8,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const model: ModelRegistryEntry = {
      ...MODEL_FOR_PRIORS,
      id: "m6",
      identity: { ...MODEL_FOR_PRIORS.identity, status: "probation" },
    };
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("m6", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("m6", "code", "medium");
    const updated = await registry.getModel("m6");
    expect(updated).not.toBeNull();
    expect(updated!.identity.status).toBe("active");
  });

  it("returns null when no observations for taskType/difficulty", async () => {
    const obs = [
      makeObservation("m7", { taskType: "writing", difficulty: "low" }),
    ];
    const storage = new InMemoryStorageAdapter([{ ...MODEL_FOR_PRIORS, id: "m7" }]);
    storage.seedObservations("m7", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const prior = await evalSvc.updatePriors("m7", "code", "medium");
    expect(prior).toBeNull();
  });

  it("probation: governance minQualityPrior overrides default when qualityPrior < minQualityPrior", async () => {
    const obs = makeObservations("m8", 35, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.6,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const model: ModelRegistryEntry = {
      ...MODEL_FOR_PRIORS,
      id: "m8",
      identity: { ...MODEL_FOR_PRIORS.identity, status: "active" },
      governance: { minQualityPrior: 0.65 },
    };
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("m8", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("m8", "code", "medium");
    const updated = await registry.getModel("m8");
    expect(updated).not.toBeNull();
    expect(updated!.identity.status).toBe("probation");
  });

  it("probation: avgCostRatio > maxCostVarianceRatio when set", async () => {
    const obs = makeObservations("m9", 35, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.8,
      actualCostUSD: 0.04,
      predictedCostUSD: 0.01,
    });
    const model: ModelRegistryEntry = {
      ...MODEL_FOR_PRIORS,
      id: "m9",
      identity: { ...MODEL_FOR_PRIORS.identity, status: "active" },
      governance: { maxCostVarianceRatio: 3.0 },
    };
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("m9", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("m9", "code", "medium");
    const updated = await registry.getModel("m9");
    expect(updated).not.toBeNull();
    expect(updated!.identity.status).toBe("probation");
  });

  it("auto-disable: probation + sampleCount>=60 + still failing => disableModel", async () => {
    const orig = process.env.MODEL_HR_AUTO_APPLY_DISABLE;
    process.env.MODEL_HR_AUTO_APPLY_DISABLE = "1";
    try {
    const obs = makeObservations("m10", 65, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.5,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const model: ModelRegistryEntry = {
      ...MODEL_FOR_PRIORS,
      id: "m10",
      identity: { ...MODEL_FOR_PRIORS.identity, status: "probation" },
      governance: { minQualityPrior: 0.55 },
    };
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("m10", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("m10", "code", "medium");
    const updated = await registry.getModel("m10");
    expect(updated).not.toBeNull();
    expect(updated!.identity.status).toBe("disabled");
    expect(updated!.identity.disabledReason).toBe("auto_disabled_regression");
    } finally {
      process.env.MODEL_HR_AUTO_APPLY_DISABLE = orig;
    }
  });

  it("computes defectRate = fraction with defectCount>0 and stores in prior", async () => {
    const obs = [
      makeObservation("m-defect", { actualQuality: 0.8, defectCount: 0 }),
      makeObservation("m-defect", { actualQuality: 0.8, defectCount: 2 }),
      makeObservation("m-defect", { actualQuality: 0.8, defectCount: 0 }),
      makeObservation("m-defect", { actualQuality: 0.8, defectCount: 1 }),
    ].map((o) => ({ ...o, taskType: "code", difficulty: "medium" }));
    const storage = new InMemoryStorageAdapter([{ ...MODEL_FOR_PRIORS, id: "m-defect" }]);
    storage.seedObservations("m-defect", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const prior = await evalSvc.updatePriors("m-defect", "code", "medium");
    expect(prior).not.toBeNull();
    expect(prior!.defectRate).toBe(0.5);
  });

  it("reduces qualityPrior when defectRate high (bounded adjustment)", async () => {
    const obs = makeObservations("m-defect-high", 40, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.85,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    }).map((o, i) => ({
      ...o,
      defectCount: i < 24 ? 1 : 0,
    }));
    const storage = new InMemoryStorageAdapter([{ ...MODEL_FOR_PRIORS, id: "m-defect-high" }]);
    storage.seedObservations("m-defect-high", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const prior = await evalSvc.updatePriors("m-defect-high", "code", "medium");
    expect(prior).not.toBeNull();
    expect(prior!.defectRate).toBe(24 / 40);
    expect(prior!.qualityPrior).toBeLessThan(0.85);
    expect(prior!.qualityPrior).toBeGreaterThanOrEqual(0.77);
  });

  it("no auto-disable when disableAutoDisable=true", async () => {
    const obs = makeObservations("m11", 65, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.5,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const model: ModelRegistryEntry = {
      ...MODEL_FOR_PRIORS,
      id: "m11",
      identity: { ...MODEL_FOR_PRIORS.identity, status: "probation" },
      governance: { minQualityPrior: 0.55, disableAutoDisable: true },
    };
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("m11", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("m11", "code", "medium");
    const updated = await registry.getModel("m11");
    expect(updated).not.toBeNull();
    expect(updated!.identity.status).toBe("probation");
  });
});
