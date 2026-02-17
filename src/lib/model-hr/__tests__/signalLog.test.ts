import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { emitModelHrSignal, readModelHrSignals } from "../signals/signalLog.js";

const TEST_DIR = join(tmpdir(), `model-hr-signals-test-${Date.now()}`);

describe("Model HR Signal Log", () => {
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    process.env.MODEL_HR_DATA_DIR = TEST_DIR;
    await mkdir(TEST_DIR, { recursive: true });
    try {
      await unlink(join(TEST_DIR, "signals.jsonl"));
    } catch {
      /* ignore if not exists */
    }
  });

  afterEach(() => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
  });

  it("emitModelHrSignal appends to file and readModelHrSignals returns signals", async () => {
    emitModelHrSignal({
      modelId: "gpt-4o",
      previousStatus: "active",
      newStatus: "probation",
      reason: "quality_below_threshold",
      sampleCount: 35,
    });
    emitModelHrSignal({
      modelId: "claude-3",
      previousStatus: "probation",
      newStatus: "disabled",
      reason: "auto_disabled_regression",
      sampleCount: 65,
    });
    await new Promise((r) => setTimeout(r, 150));
    const signals = await readModelHrSignals(10);
    expect(signals.length).toBeGreaterThanOrEqual(2);
    const gpt = signals.find((s) => s.modelId === "gpt-4o");
    const claude = signals.find((s) => s.modelId === "claude-3");
    expect(gpt).toBeDefined();
    expect(gpt!.previousStatus).toBe("active");
    expect(gpt!.newStatus).toBe("probation");
    expect(gpt!.reason).toBe("quality_below_threshold");
    expect(gpt!.sampleCount).toBe(35);
    expect(gpt!.tsISO).toBeDefined();
    expect(claude).toBeDefined();
    expect(claude!.reason).toBe("auto_disabled_regression");
  });

  it("readModelHrSignals respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      emitModelHrSignal({
        modelId: `model-${i}`,
        previousStatus: "active",
        newStatus: "probation",
        reason: "test",
      });
    }
    await new Promise((r) => setTimeout(r, 200));
    const signals = await readModelHrSignals(2);
    expect(signals.length).toBe(2);
    expect(signals.every((s) => s.modelId?.startsWith("model-"))).toBe(true);
    expect(new Set(signals.map((s) => s.modelId)).size).toBe(2);
  });

  it("readModelHrSignals returns [] when file does not exist", async () => {
    process.env.MODEL_HR_DATA_DIR = join(tmpdir(), `nonexistent-signals-${Date.now()}`);
    const signals = await readModelHrSignals(10);
    expect(signals).toEqual([]);
  });

  it("EvaluationService probation emits MODEL_HR_SIGNAL", async () => {
    const { EvaluationService } = await import("../evaluation/evaluationService.js");
    const { RegistryService } = await import("../registry/registryService.js");
    const { InMemoryStorageAdapter } = await import("./inMemoryStorage.js");
    const { makeObservations } = await import("./fixtures.js");
    const model = {
      id: "signal-test-model",
      identity: { provider: "openai", modelId: "signal-test-model", status: "active" as const },
      displayName: "Signal Test",
      pricing: { inPer1k: 0.001, outPer1k: 0.002, currency: "USD" },
      expertise: { general: 0.8 },
      reliability: 0.85,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    };
    const obs = makeObservations("signal-test-model", 35, {
      taskType: "code",
      difficulty: "medium",
      actualQuality: 0.5,
      actualCostUSD: 0.01,
      predictedCostUSD: 0.01,
    });
    const storage = new InMemoryStorageAdapter([model]);
    storage.seedObservations("signal-test-model", obs);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await evalSvc.updatePriors("signal-test-model", "code", "medium");
    await new Promise((r) => setTimeout(r, 150));
    const signals = await readModelHrSignals(10);
    const probationSignal = signals.find(
      (s) => s.modelId === "signal-test-model" && s.newStatus === "probation"
    );
    expect(probationSignal).toBeDefined();
    expect(probationSignal!.reason).toMatch(/quality|cost/);
    expect(probationSignal!.sampleCount).toBe(35);
  });
});
