import { describe, it, expect } from "vitest";
import { evaluateSuiteForStatusChange } from "../canary/canaryPolicy.js";
import type { CanarySuiteResult } from "../canary/types.js";

function makeSuite(
  overrides: Partial<CanarySuiteResult> & { failedCount: number; avgQuality: number }
): CanarySuiteResult {
  return {
    suiteId: "default",
    modelId: "gpt-4o-mini",
    results: [],
    pass: overrides.failedCount === 0 && overrides.avgQuality >= 0.7,
    avgQuality: overrides.avgQuality,
    failedCount: overrides.failedCount,
    ...overrides,
  };
}

describe("canaryPolicy.evaluateSuiteForStatusChange", () => {
  it("failedCount >= 2 => probation", () => {
    const r = evaluateSuiteForStatusChange("m1", makeSuite({ failedCount: 2, avgQuality: 0.9 }));
    expect(r.action).toBe("probation");
    expect(r.reason).toBe("canary_regression");
  });

  it("avgQuality < 0.70 => probation", () => {
    const r = evaluateSuiteForStatusChange("m2", makeSuite({ failedCount: 0, avgQuality: 0.65 }));
    expect(r.action).toBe("probation");
    expect(r.reason).toBe("canary_regression");
  });

  it("avgQuality >= 0.82 and failedCount == 0 => active", () => {
    const r = evaluateSuiteForStatusChange("m3", makeSuite({ failedCount: 0, avgQuality: 0.85 }));
    expect(r.action).toBe("active");
    expect(r.reason).toBe("canary_graduate");
  });

  it("avgQuality 0.82 exactly and failedCount 0 => active", () => {
    const r = evaluateSuiteForStatusChange("m4", makeSuite({ failedCount: 0, avgQuality: 0.82 }));
    expect(r.action).toBe("active");
  });

  it("avgQuality 0.81 and failedCount 0 => none", () => {
    const r = evaluateSuiteForStatusChange("m5", makeSuite({ failedCount: 0, avgQuality: 0.81 }));
    expect(r.action).toBe("none");
    expect(r.reason).toBe("no_change");
  });

  it("avgQuality 0.75 and failedCount 1 => none", () => {
    const r = evaluateSuiteForStatusChange("m6", makeSuite({ failedCount: 1, avgQuality: 0.75 }));
    expect(r.action).toBe("none");
  });

  it("failedCount 1 and avgQuality 0.9 => none (single failure not enough for probation)", () => {
    const r = evaluateSuiteForStatusChange("m7", makeSuite({ failedCount: 1, avgQuality: 0.9 }));
    expect(r.action).toBe("none");
  });

  it("avgQuality 0.69 => probation", () => {
    const r = evaluateSuiteForStatusChange("m8", makeSuite({ failedCount: 0, avgQuality: 0.69 }));
    expect(r.action).toBe("probation");
  });

  it("default thresholds unchanged when governance is undefined", () => {
    const r = evaluateSuiteForStatusChange("m9", makeSuite({ failedCount: 2, avgQuality: 0.9 }), undefined);
    expect(r.action).toBe("probation");
    const r2 = evaluateSuiteForStatusChange("m10", makeSuite({ failedCount: 0, avgQuality: 0.82 }), null);
    expect(r2.action).toBe("active");
  });

  it("override probationFailCount: 3 failures required for probation", () => {
    const gov = { canaryThresholds: { probationFailCount: 3 } };
    const r = evaluateSuiteForStatusChange("m11", makeSuite({ failedCount: 2, avgQuality: 0.9 }), gov);
    expect(r.action).toBe("none");
    const r2 = evaluateSuiteForStatusChange("m12", makeSuite({ failedCount: 3, avgQuality: 0.9 }), gov);
    expect(r2.action).toBe("probation");
  });

  it("override probationQuality: 0.65 threshold", () => {
    const gov = { canaryThresholds: { probationQuality: 0.65 } };
    const r = evaluateSuiteForStatusChange("m13", makeSuite({ failedCount: 0, avgQuality: 0.64 }), gov);
    expect(r.action).toBe("probation");
    const r2 = evaluateSuiteForStatusChange("m14", makeSuite({ failedCount: 0, avgQuality: 0.66 }), gov);
    expect(r2.action).toBe("none");
  });

  it("override graduateQuality: 0.90 required for active", () => {
    const gov = { canaryThresholds: { graduateQuality: 0.9 } };
    const r = evaluateSuiteForStatusChange("m15", makeSuite({ failedCount: 0, avgQuality: 0.85 }), gov);
    expect(r.action).toBe("none");
    const r2 = evaluateSuiteForStatusChange("m16", makeSuite({ failedCount: 0, avgQuality: 0.92 }), gov);
    expect(r2.action).toBe("active");
  });
});
