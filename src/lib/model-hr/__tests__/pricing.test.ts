import { describe, it, expect } from "vitest";
import {
  computePricingExpectedCostUSD,
  detectPricingMismatch,
  PRICING_MISMATCH_THRESHOLD,
} from "../pricing.js";

describe("computePricingExpectedCostUSD", () => {
  const pricing = { inPer1k: 0.001, outPer1k: 0.003 };

  it("computes cost from input/output tokens without multiplier", () => {
    const cost = computePricingExpectedCostUSD(
      pricing,
      { input: 1000, output: 500 }
    );
    expect(cost).toBe(0.001 * 1 + 0.003 * 0.5);
    expect(cost).toBe(0.0025);
  });

  it("applies costMultiplier when provided", () => {
    const cost = computePricingExpectedCostUSD(
      pricing,
      { input: 2000, output: 1000 },
      1.5
    );
    const raw = 0.001 * 2 + 0.003 * 1;
    expect(cost).toBe(raw * 1.5);
    expect(cost).toBe(0.0075);
  });

  it("uses 1 when costMultiplier is undefined", () => {
    const cost = computePricingExpectedCostUSD(
      pricing,
      { input: 1000, output: 1000 }
    );
    expect(cost).toBe(0.004);
  });

  it("handles zero tokens", () => {
    const cost = computePricingExpectedCostUSD(
      pricing,
      { input: 0, output: 0 }
    );
    expect(cost).toBe(0);
  });
});

describe("detectPricingMismatch", () => {
  it("returns no mismatch when ratio is within threshold", () => {
    expect(detectPricingMismatch(0.01, 0.01)).toEqual({
      mismatch: false,
      ratio: 1,
    });
    expect(detectPricingMismatch(0.015, 0.01)).toEqual({
      mismatch: false,
      ratio: 1.5,
    });
    expect(detectPricingMismatch(0.005, 0.01)).toEqual({
      mismatch: false,
      ratio: 0.5,
    });
  });

  it("returns mismatch when ratio exceeds threshold", () => {
    const r = detectPricingMismatch(0.025, 0.01);
    expect(r.mismatch).toBe(true);
    expect(r.ratio).toBe(2.5);
  });

  it("returns mismatch when ratio is below 1/threshold", () => {
    const r = detectPricingMismatch(0.003, 0.01);
    expect(r.mismatch).toBe(true);
    expect(r.ratio).toBe(0.3);
  });

  it("returns no mismatch when ratio equals threshold boundary", () => {
    expect(detectPricingMismatch(0.02, 0.01)).toEqual({
      mismatch: false,
      ratio: 2,
    });
    expect(detectPricingMismatch(0.005, 0.01)).toEqual({
      mismatch: false,
      ratio: 0.5,
    });
  });

  it("returns no mismatch when expectedCostUSD is 0", () => {
    expect(detectPricingMismatch(0.01, 0)).toEqual({
      mismatch: false,
      ratio: 1,
    });
  });

  it("respects custom threshold", () => {
    expect(detectPricingMismatch(0.02, 0.01, 1.5)).toEqual({
      mismatch: true,
      ratio: 2,
    });
    expect(detectPricingMismatch(0.015, 0.01, 2)).toEqual({
      mismatch: false,
      ratio: 1.5,
    });
  });
});
