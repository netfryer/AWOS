/**
 * Tests for ModelObservation optional QA fields (defectCount, defectSamples, qaMode, etc.)
 */

import { describe, it, expect } from "vitest";
import { EvaluationService } from "../evaluation/evaluationService.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import { makeObservation } from "./fixtures.js";
import type { ModelRegistryEntry } from "../types.js";

const now = "2025-01-15T12:00:00.000Z";

const MODEL: ModelRegistryEntry = {
  id: "openai/gpt-4o",
  identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
  displayName: "GPT-4o",
  pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
  expertise: { general: 0.9 },
  reliability: 0.9,
  createdAtISO: now,
  updatedAtISO: now,
};

describe("ModelObservation optional QA fields", () => {
  it("persists and loads observation with defectCount, defectSamples, qaMode, deterministicNoSignal, budgetGated", async () => {
    const storage = new InMemoryStorageAdapter([MODEL]);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    const obs = makeObservation("openai/gpt-4o", {
      taskType: "analysis",
      difficulty: "medium",
      actualQuality: 0.75,
      defectCount: 2,
      defectSamples: ["Missing lint script", "Test timeout"],
      qaMode: "hybrid",
      deterministicNoSignal: true,
      budgetGated: false,
    });

    await evalSvc.recordObservation(obs);

    const loaded = await storage.loadObservations("openai/gpt-4o", 10);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].defectCount).toBe(2);
    expect(loaded[0].defectSamples).toEqual(["Missing lint script", "Test timeout"]);
    expect(loaded[0].qaMode).toBe("hybrid");
    expect(loaded[0].deterministicNoSignal).toBe(true);
    expect(loaded[0].budgetGated).toBe(false);
  });

  it("recordObservation never throws", async () => {
    const storage = new InMemoryStorageAdapter([MODEL]);
    const registry = new RegistryService(storage);
    const evalSvc = new EvaluationService(registry);

    await expect(
      evalSvc.recordObservation(
        makeObservation("openai/gpt-4o", {
          defectCount: 1,
          defectTags: ["lint"],
          qaMode: "deterministic",
          budgetGated: true,
        })
      )
    ).resolves.toBeUndefined();
  });
});
