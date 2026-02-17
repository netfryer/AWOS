import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  processProviderModel,
  processProviderModels,
  readModelHrSignals,
} from "../index.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import type { ProviderModelInput } from "../recruiting/normalization.js";

const TEST_DIR = join(tmpdir(), `model-hr-recruiting-test-${Date.now()}`);

function makeInput(overrides: Partial<ProviderModelInput> = {}): ProviderModelInput {
  return {
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
    allowedTiers: ["cheap", "standard", "premium"],
    expertise: { code: 0.92, writing: 0.88, analysis: 0.9, general: 0.9 },
    reliability: 0.98,
    ...overrides,
  };
}

describe("RecruitingService", () => {
  let originalEnv: string | undefined;
  let registry: RegistryService;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    process.env.MODEL_HR_DATA_DIR = TEST_DIR;
    await mkdir(TEST_DIR, { recursive: true });
    try {
      await unlink(join(TEST_DIR, "signals.jsonl"));
    } catch {
      /* ignore */
    }
    registry = new RegistryService(new InMemoryStorageAdapter());
  });

  afterEach(() => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
  });

  it("new model -> probation + canaryStatus=none + signal model_created", async () => {
    const item = await processProviderModel("openai", makeInput(), {}, registry);
    expect(item.action).toBe("created");
    expect(item.reason).toBe("model_created");

    const model = await registry.getModel("openai/gpt-4o");
    expect(model).not.toBeNull();
    expect(model!.identity.status).toBe("probation");
    expect(model!.evaluationMeta?.canaryStatus).toBe("none");
    expect(model!.id).toBe("openai/gpt-4o");
    expect(model!.identity.modelId).toBe("gpt-4o");

    await new Promise((r) => setTimeout(r, 100));
    const signals = await readModelHrSignals(10);
    const created = signals.find((s) => s.modelId === "openai/gpt-4o" && s.reason === "model_created");
    expect(created).toBeDefined();
    expect(created!.previousStatus).toBe("none");
    expect(created!.newStatus).toBe("probation");
  });

  it("pricing update -> signal pricing_changed, preserve priors/meta", async () => {
    const existing = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" as const },
      displayName: "GPT-4o",
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      expertise: { code: 0.9, general: 0.9 },
      reliability: 0.95,
      governance: { allowedTiers: ["cheap", "standard", "premium"] },
      performancePriors: [
        {
          taskType: "code",
          difficulty: "medium",
          qualityPrior: 0.85,
          costMultiplier: 1.1,
          calibrationConfidence: 0.8,
          lastUpdatedISO: "2025-01-01T00:00:00.000Z",
          sampleCount: 30,
        },
      ],
      evaluationMeta: { canaryStatus: "passed" as const, lastBenchmarkISO: "2025-01-10T00:00:00.000Z" },
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };
    const storage = new InMemoryStorageAdapter([existing]);
    const reg = new RegistryService(storage);

    const item = await processProviderModel(
      "openai",
      makeInput({
        pricing: { inPer1k: 0.003, outPer1k: 0.012, currency: "USD" },
        expertise: { code: 0.9, general: 0.9 },
        displayName: "GPT-4o",
        reliability: 0.95,
        allowedTiers: ["cheap", "standard", "premium"],
      }),
      {},
      reg
    );
    expect(item.action).toBe("updated");
    expect(item.reason).toBe("pricing_changed");

    const model = await reg.getModel("openai/gpt-4o");
    expect(model).not.toBeNull();
    expect(model!.pricing.inPer1k).toBe(0.003);
    expect(model!.pricing.outPer1k).toBe(0.012);
    expect(model!.performancePriors).toHaveLength(1);
    expect(model!.performancePriors![0].qualityPrior).toBe(0.85);
    expect(model!.evaluationMeta?.canaryStatus).toBe("passed");
    expect(model!.identity.status).toBe("active");

    await new Promise((r) => setTimeout(r, 100));
    const signals = await readModelHrSignals(10);
    const pricing = signals.find((s) => s.modelId === "openai/gpt-4o" && s.reason === "pricing_changed");
    expect(pricing).toBeDefined();
  });

  it("metadata update -> signal metadata_changed", async () => {
    const existing = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" as const },
      displayName: "GPT-4o",
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      expertise: { code: 0.9, general: 0.9 },
      reliability: 0.95,
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };
    const storage = new InMemoryStorageAdapter([existing]);
    const reg = new RegistryService(storage);

    const item = await processProviderModel(
      "openai",
      makeInput({ displayName: "GPT-4o Updated", reliability: 0.99 }),
      {},
      reg
    );
    expect(item.action).toBe("updated");
    expect(item.reason).toBe("metadata_changed");

    const model = await reg.getModel("openai/gpt-4o");
    expect(model).not.toBeNull();
    expect(model!.displayName).toBe("GPT-4o Updated");
    expect(model!.reliability).toBe(0.99);

    await new Promise((r) => setTimeout(r, 100));
    const signals = await readModelHrSignals(10);
    const meta = signals.find((s) => s.modelId === "openai/gpt-4o" && s.reason === "metadata_changed");
    expect(meta).toBeDefined();
  });

  it("refuse force active on new model unless override flag passed", async () => {
    await expect(
      processProviderModel(
        "openai",
        makeInput(),
        { forceActiveOverride: false },
        registry
      )
    ).resolves.toMatchObject({ action: "created", reason: "model_created" });

    const model = await registry.getModel("openai/gpt-4o");
    expect(model!.identity.status).toBe("probation");

    const storage2 = new InMemoryStorageAdapter();
    const reg2 = new RegistryService(storage2);
    await expect(
      processProviderModel(
        "anthropic",
        makeInput({ modelId: "claude-new", displayName: "Claude New" }),
        { forceActiveOverride: false },
        reg2
      )
    ).resolves.toMatchObject({ action: "created" });

    const reg3 = new RegistryService(new InMemoryStorageAdapter());
    const item = await processProviderModel(
      "anthropic",
      makeInput({ modelId: "claude-force", displayName: "Claude Force" }),
      { forceActiveOverride: true },
      reg3
    );
    expect(item.action).toBe("created");
    expect(item.reason).toBe("status_forced_override");

    const forceModel = await reg3.getModel("anthropic/claude-force");
    expect(forceModel).not.toBeNull();
    expect(forceModel!.identity.status).toBe("active");

    await new Promise((r) => setTimeout(r, 100));
    const signals = await readModelHrSignals(10);
    const override = signals.find(
      (s) => s.modelId === "anthropic/claude-force" && s.reason === "status_forced_override"
    );
    expect(override).toBeDefined();
  });

  it("unchanged model -> skipped", async () => {
    const existing = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" as const },
      displayName: "GPT-4o",
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      expertise: { code: 0.9, general: 0.9 },
      reliability: 0.98,
      governance: { allowedTiers: ["cheap", "standard", "premium"] },
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };
    const storage = new InMemoryStorageAdapter([existing]);
    const reg = new RegistryService(storage);

    const item = await processProviderModel(
      "openai",
      makeInput({
        expertise: { code: 0.9, general: 0.9 },
        reliability: 0.98,
        allowedTiers: ["cheap", "standard", "premium"],
      }),
      {},
      reg
    );
    expect(item.action).toBe("skipped");
    expect(item.reason).toBe("unchanged");
  });

  it("processProviderModels returns report", async () => {
    const baseExpertise = { code: 0.9, general: 0.9 };
    const baseTiers = ["cheap", "standard", "premium"] as const;
    const existing = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" as const },
      displayName: "GPT-4o",
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      expertise: baseExpertise,
      reliability: 0.9,
      governance: { allowedTiers: [...baseTiers] },
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };
    const storage = new InMemoryStorageAdapter([existing]);
    const reg = new RegistryService(storage);

    const report = await processProviderModels(
      "openai",
      [
        makeInput({ expertise: baseExpertise, reliability: 0.9, allowedTiers: [...baseTiers] }), // unchanged
        makeInput({
          modelId: "gpt-4o-mini",
          displayName: "GPT-4o Mini",
          pricing: { inPer1k: 0.00015, outPer1k: 0.0006, currency: "USD" },
        }), // new
        makeInput({
          pricing: { inPer1k: 0.003, outPer1k: 0.012, currency: "USD" },
          expertise: baseExpertise,
          reliability: 0.9,
          allowedTiers: [...baseTiers],
        }), // pricing changed
      ],
      {},
      reg
    );

    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].modelId).toBe("gpt-4o");
    expect(report.created).toHaveLength(1);
    expect(report.created[0].modelId).toBe("gpt-4o-mini");
    expect(report.updated).toHaveLength(1);
    expect(report.updated[0].modelId).toBe("gpt-4o");
    expect(report.updated[0].reason).toBe("pricing_changed");
  });
});
