import { describe, it, expect } from "vitest";
import {
  needsCanary,
  countEscalations,
  priorsFailCostVariance,
  priorsMeetPromotionThresholds,
  type ModelHrSignal,
} from "../cycleSelection.js";
import type { ModelRegistryEntry } from "../../../src/lib/model-hr/types.js";

const NOW = new Date("2025-02-15T12:00:00.000Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function makeModel(overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry {
  return {
    id: "openai/gpt-4o",
    identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
    displayName: "GPT-4o",
    pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
    expertise: { general: 0.9 },
    reliability: 0.9,
    createdAtISO: "2025-02-01T00:00:00.000Z",
    updatedAtISO: "2025-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSignal(overrides: Partial<ModelHrSignal> = {}): ModelHrSignal {
  return {
    modelId: "openai/gpt-4o",
    reason: "canary_regression",
    tsISO: new Date(NOW - 3 * DAY_MS).toISOString(),
    ...overrides,
  };
}

describe("cycleSelection.needsCanary", () => {
  it("probation => true", () => {
    const m = makeModel({ identity: { ...makeModel().identity, status: "probation" } });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(true);
  });

  it("disabled => false", () => {
    const m = makeModel({ identity: { ...makeModel().identity, status: "disabled" } });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(false);
  });

  it("created within 14 days => true", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 10 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "passed" },
    });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(true);
  });

  it("created 20 days ago with canary passed => false", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "passed" },
    });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(false);
  });

  it("canaryStatus none => true", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "none" },
    });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(true);
  });

  it("canaryStatus failed => true", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "failed" },
    });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(true);
  });

  it("canaryStatus undefined => true", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: undefined,
    });
    expect(needsCanary(m, [], 14, 7, NOW)).toBe(true);
  });

  it("pricing_changed signal in last 7 days => true", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "passed" },
    });
    const signals = [
      makeSignal({ reason: "pricing_changed", tsISO: new Date(NOW - 3 * DAY_MS).toISOString() }),
    ];
    expect(needsCanary(m, signals, 14, 7, NOW)).toBe(true);
  });

  it("metadata_changed signal in last 7 days => true", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "passed" },
    });
    const signals = [
      makeSignal({ reason: "metadata_changed", tsISO: new Date(NOW - 2 * DAY_MS).toISOString() }),
    ];
    expect(needsCanary(m, signals, 14, 7, NOW)).toBe(true);
  });

  it("pricing_changed signal 10 days ago => false", () => {
    const m = makeModel({
      createdAtISO: new Date(NOW - 20 * DAY_MS).toISOString(),
      evaluationMeta: { canaryStatus: "passed" },
    });
    const signals = [
      makeSignal({ reason: "pricing_changed", tsISO: new Date(NOW - 10 * DAY_MS).toISOString() }),
    ];
    expect(needsCanary(m, signals, 14, 7, NOW)).toBe(false);
  });
});

describe("cycleSelection.countEscalations", () => {
  it("counts escalation reasons in window", () => {
    const signals: ModelHrSignal[] = [
      makeSignal({ reason: "canary_regression", tsISO: new Date(NOW - 2 * DAY_MS).toISOString() }),
      makeSignal({ reason: "quality_below_threshold", tsISO: new Date(NOW - 5 * DAY_MS).toISOString() }),
      makeSignal({ reason: "pricing_changed", tsISO: new Date(NOW - 3 * DAY_MS).toISOString() }),
    ];
    expect(countEscalations(signals, 7, NOW)).toBe(2);
  });

  it("ignores signals outside window", () => {
    const signals: ModelHrSignal[] = [
      makeSignal({ reason: "canary_regression", tsISO: new Date(NOW - 10 * DAY_MS).toISOString() }),
    ];
    expect(countEscalations(signals, 7, NOW)).toBe(0);
  });
});

describe("cycleSelection.priorsFailCostVariance", () => {
  it("returns true when costMultiplier exceeds max", () => {
    expect(priorsFailCostVariance([{ costMultiplier: 4, varianceBandHigh: 3 }], 3)).toBe(true);
  });

  it("returns true when varianceBandHigh exceeds max", () => {
    expect(priorsFailCostVariance([{ costMultiplier: 2, varianceBandHigh: 5 }], 3)).toBe(true);
  });

  it("returns false when within bounds", () => {
    expect(priorsFailCostVariance([{ costMultiplier: 2, varianceBandHigh: 2.5 }], 3)).toBe(false);
  });

  it("returns false when maxCostVarianceRatio undefined", () => {
    expect(priorsFailCostVariance([{ costMultiplier: 10 }], undefined)).toBe(false);
  });
});

describe("cycleSelection.priorsMeetPromotionThresholds", () => {
  it("returns true when all priors meet thresholds", () => {
    expect(
      priorsMeetPromotionThresholds(
        [{ qualityPrior: 0.85, costMultiplier: 1.2 }],
        0.75,
        5
      )
    ).toBe(true);
  });

  it("returns false when qualityPrior below min", () => {
    expect(
      priorsMeetPromotionThresholds(
        [{ qualityPrior: 0.7, costMultiplier: 1.2 }],
        0.75,
        5
      )
    ).toBe(false);
  });

  it("returns false when costMultiplier exceeds max", () => {
    expect(
      priorsMeetPromotionThresholds(
        [{ qualityPrior: 0.85, costMultiplier: 6 }],
        0.75,
        5
      )
    ).toBe(false);
  });

  it("returns false when no priors", () => {
    expect(priorsMeetPromotionThresholds([], 0.75, 5)).toBe(false);
  });
});
