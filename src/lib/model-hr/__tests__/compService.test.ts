import { describe, it, expect } from "vitest";
import { computePredictedCostUSD } from "../comp/compService.js";
import type { ModelRegistryEntry, ModelPerformancePrior } from "../types.js";

function makeEntry(overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry {
  return {
    id: "openai/gpt-4o",
    identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
    pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
    createdAtISO: "2025-01-01T00:00:00.000Z",
    updatedAtISO: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_CTX = { taskType: "code", difficulty: "medium", tierProfile: "standard" as const };

describe("computePredictedCostUSD", () => {
  it("applies costMultiplier from priors when available", () => {
    const entry = makeEntry();
    const priors: ModelPerformancePrior[] = [
      {
        taskType: "code",
        difficulty: "medium",
        qualityPrior: 0.9,
        costMultiplier: 1.5,
        calibrationConfidence: 0.8,
        lastUpdatedISO: "2025-01-01T00:00:00.000Z",
        sampleCount: 30,
      },
    ];
    const result = computePredictedCostUSD(
      entry,
      { input: 2000, output: 1000 },
      BASE_CTX,
      priors
    );
    const raw = (2000 / 1000) * 0.0025 + (1000 / 1000) * 0.01;
    expect(result.expectedCostUSD).toBeCloseTo(raw, 6);
    expect(result.predictedCostUSD).toBeCloseTo(raw * 1.5, 6);
    expect(result.costMultiplierUsed).toBe(1.5);
    expect(result.inputsBreakdown.costMultiplierUsed).toBe(1.5);
  });

  it("uses 1 when priors missing or no matching prior", () => {
    const entry = makeEntry();
    const result = computePredictedCostUSD(
      entry,
      { input: 2000, output: 1000 },
      BASE_CTX,
      undefined
    );
    const raw = (2000 / 1000) * 0.0025 + (1000 / 1000) * 0.01;
    expect(result.predictedCostUSD).toBeCloseTo(raw, 6);
    expect(result.costMultiplierUsed).toBe(1);
  });

  it("uses 1 when priors empty array", () => {
    const entry = makeEntry();
    const result = computePredictedCostUSD(
      entry,
      { input: 1000, output: 500 },
      BASE_CTX,
      []
    );
    const raw = (1000 / 1000) * 0.0025 + (500 / 1000) * 0.01;
    expect(result.predictedCostUSD).toBeCloseTo(raw, 6);
    expect(result.costMultiplierUsed).toBe(1);
  });

  it("uses 1 when prior taskType/difficulty mismatch", () => {
    const entry = makeEntry();
    const priors: ModelPerformancePrior[] = [
      {
        taskType: "analysis",
        difficulty: "high",
        qualityPrior: 0.9,
        costMultiplier: 2,
        calibrationConfidence: 0.8,
        lastUpdatedISO: "2025-01-01T00:00:00.000Z",
        sampleCount: 30,
      },
    ];
    const result = computePredictedCostUSD(
      entry,
      { input: 1000, output: 500 },
      BASE_CTX,
      priors
    );
    expect(result.costMultiplierUsed).toBe(1);
    const raw = (1000 / 1000) * 0.0025 + (500 / 1000) * 0.01;
    expect(result.predictedCostUSD).toBeCloseTo(raw, 6);
  });

  it("handles zero tokens", () => {
    const entry = makeEntry();
    const result = computePredictedCostUSD(
      entry,
      { input: 0, output: 0 },
      BASE_CTX,
      undefined
    );
    expect(result.predictedCostUSD).toBe(0);
    expect(result.expectedCostUSD).toBe(0);
    expect(result.inputsBreakdown.rawCostUSD).toBe(0);
  });

  it("produces stable rounding to 6 decimals", () => {
    const entry = makeEntry({ pricing: { inPer1k: 0.001111, outPer1k: 0.003333, currency: "USD" } });
    const result = computePredictedCostUSD(
      entry,
      { input: 1234, output: 567 },
      BASE_CTX,
      undefined
    );
    const str = result.predictedCostUSD.toString();
    const decimals = str.includes(".") ? str.split(".")[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });

  it("inputsBreakdown is traceable", () => {
    const entry = makeEntry({ pricing: { inPer1k: 0.002, outPer1k: 0.008, currency: "USD" } });
    const tokens = { input: 3000, output: 1500 };
    const result = computePredictedCostUSD(entry, tokens, BASE_CTX, undefined);
    expect(result.inputsBreakdown.inPer1k).toBe(0.002);
    expect(result.inputsBreakdown.outPer1k).toBe(0.008);
    expect(result.inputsBreakdown.inputTokens).toBe(3000);
    expect(result.inputsBreakdown.outputTokens).toBe(1500);
    const expectedRaw = (3000 / 1000) * 0.002 + (1500 / 1000) * 0.008;
    expect(result.inputsBreakdown.rawCostUSD).toBeCloseTo(expectedRaw, 6);
    expect(result.predictedCostUSD).toBeCloseTo(expectedRaw, 6);
  });

  it("produces predictedCostUSD within ~2x of actual for typical run (~1400 tokens)", () => {
    const entry = makeEntry();
    const tokens = { input: 840, output: 560 };
    const result = computePredictedCostUSD(entry, tokens, BASE_CTX, undefined);
    const actualApprox = 0.009;
    expect(result.predictedCostUSD).toBeGreaterThan(0.001);
    expect(result.predictedCostUSD).toBeLessThan(actualApprox * 3);
    expect(result.predictedCostUSD).toBeCloseTo(0.840 * 0.0025 + 0.56 * 0.01, 4);
  });
});
