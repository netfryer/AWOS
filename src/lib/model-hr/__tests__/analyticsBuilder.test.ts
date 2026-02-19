import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildModelHrAnalytics, DEFAULT_ANALYTICS_REGISTRY } from "../analytics/analyticsBuilder.js";

describe("analyticsBuilder", () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    testDir = join(tmpdir(), `model-hr-analytics-test-${Date.now()}`);
    process.env.MODEL_HR_DATA_DIR = testDir;
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "observations"), { recursive: true });
  });

  afterEach(async () => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns valid shape when all files are missing", async () => {
    const result = await buildModelHrAnalytics(24);
    expect(result.success).toBe(true);
    expect(result.windowHours).toBe(24);
    /** Canonical contract: registry.health, registry.fallbackCount */
    expect(result.registry).toEqual(DEFAULT_ANALYTICS_REGISTRY);
    expect(result.routing).toEqual({
      totalRoutes: 0,
      enforceCheapestViableRate: 0,
      chosenIsCheapestViableRate: 0,
      pricingMismatchRoutes: 0,
    });
    expect(result.cost).toEqual({
      avgVarianceRatio: 0,
      p80VarianceRatio: 0,
      totalActualUSD: 0,
      totalPredictedUSD: 0,
    });
    expect(result.quality).toEqual({
      avgActualQuality: 0,
      avgPredictedQuality: 0,
      calibrationError: 0,
    });
    expect(result.escalations).toEqual({
      count: 0,
      byReason: {},
      topModels: [],
    });
    expect(result.models).toEqual({
      active: 0,
      probation: 0,
      deprecated: 0,
      disabled: 0,
    });
  });

  it("reads registry-fallback.jsonl and sets health FALLBACK when fallbacks exist", async () => {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(testDir, "registry-fallback.jsonl"),
      `${JSON.stringify({ tsISO: cutoff })}\n${JSON.stringify({ tsISO: new Date().toISOString() })}\n`
    );
    const result = await buildModelHrAnalytics(24);
    expect(result.registry.health).toBe("FALLBACK");
    expect(result.registry.fallbackCount).toBeGreaterThanOrEqual(1);
  });

  it("reads models.json and counts by status", async () => {
    await writeFile(
      join(testDir, "models.json"),
      JSON.stringify([
        { identity: { status: "active" } },
        { identity: { status: "active" } },
        { identity: { status: "probation" } },
        { identity: { status: "deprecated" } },
        { identity: { status: "disabled" } },
      ])
    );
    const result = await buildModelHrAnalytics(24);
    expect(result.models).toEqual({
      active: 2,
      probation: 1,
      deprecated: 1,
      disabled: 1,
    });
  });

  it("reads observations and computes cost/quality metrics", async () => {
    const ts = new Date().toISOString();
    const obs = [
      {
        tsISO: ts,
        taskType: "code",
        difficulty: "medium",
        actualCostUSD: 0.02,
        predictedCostUSD: 0.01,
        actualQuality: 0.85,
        predictedQuality: 0.8,
      },
      {
        tsISO: ts,
        taskType: "code",
        difficulty: "easy",
        actualCostUSD: 0.03,
        predictedCostUSD: 0.01,
        actualQuality: 0.9,
        predictedQuality: 0.88,
      },
    ];
    await writeFile(join(testDir, "observations", "model-a.json"), JSON.stringify(obs));
    const result = await buildModelHrAnalytics(24);
    expect(result.cost.avgVarianceRatio).toBeCloseTo(2.5, 1); // (2 + 3) / 2 = 2.5
    expect(result.cost.totalActualUSD).toBeCloseTo(0.05, 4);
    expect(result.cost.totalPredictedUSD).toBeCloseTo(0.02, 4);
    expect(result.quality.avgActualQuality).toBeCloseTo(0.875, 2);
    expect(result.quality.avgPredictedQuality).toBeCloseTo(0.84, 2);
    expect(result.quality.calibrationError).toBeGreaterThanOrEqual(0);
  });

  it("caps observations and does not scan excessively", async () => {
    const ts = new Date().toISOString();
    const obs = Array.from({ length: 150 }, (_, i) => ({
      tsISO: ts,
      taskType: "code",
      difficulty: "medium",
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
      actualQuality: 0.8,
      predictedQuality: 0.8,
    }));
    await writeFile(join(testDir, "observations", "model-heavy.json"), JSON.stringify(obs));
    const result = await buildModelHrAnalytics(24);
    expect(result.cost.totalActualUSD).toBeLessThanOrEqual(1.5); // 100 * 0.01 = 1.0 max per model
  });

  it("integrates ledger store when provided", async () => {
    const cutoff = new Date().toISOString();
    const mockLedgerStore = {
      listLedgers: () => [
        { runSessionId: "run-1", startedAtISO: cutoff },
      ],
      getLedger: (id: string) => {
        if (id === "run-1") {
          return {
            decisions: [
              {
                type: "ROUTE",
                details: {
                  enforceCheapestViable: true,
                  chosenIsCheapestViable: true,
                  pricingMismatchCount: 0,
                },
              },
              {
                type: "ROUTE",
                details: {
                  enforceCheapestViable: false,
                  chosenIsCheapestViable: false,
                  pricingMismatchCount: 1,
                },
              },
              {
                type: "ESCALATION",
                details: {
                  reason: "quality_below_threshold",
                  context: { modelId: "gpt-4o" },
                },
              },
            ],
          };
        }
        return undefined;
      },
    };
    const result = await buildModelHrAnalytics(24, mockLedgerStore);
    expect(result.routing.totalRoutes).toBe(2);
    expect(result.routing.enforceCheapestViableRate).toBe(0.5);
    expect(result.routing.chosenIsCheapestViableRate).toBe(0.5);
    expect(result.routing.pricingMismatchRoutes).toBe(1);
    expect(result.escalations.count).toBe(1);
    expect(result.escalations.byReason["quality_below_threshold"]).toBe(1);
    expect(result.escalations.topModels).toContainEqual({ modelId: "gpt-4o", count: 1 });
  });
});
