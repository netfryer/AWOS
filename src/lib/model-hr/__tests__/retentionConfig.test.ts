/**
 * Tests for Model HR retention and configurable caps.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { emitModelHrSignal, readModelHrSignals } from "../signals/signalLog.js";
import { getRegistryFallbackCountLastHours } from "../registryHealth.js";
import { enqueueAction, listActions, approveAction } from "../actions/actionsQueue.js";
import { FileStorageAdapter } from "../registry/storage/fileStorage.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import type { ModelRegistryEntry } from "../types.js";

const MODEL: ModelRegistryEntry = {
  id: "retention-test",
  identity: { provider: "openai", modelId: "retention-test", status: "active" },
  displayName: "Retention Test",
  pricing: { inPer1k: 0.001, outPer1k: 0.002, currency: "USD" },
  createdAtISO: "2025-01-01T00:00:00.000Z",
  updatedAtISO: "2025-01-01T00:00:00.000Z",
};

describe("retention and config", () => {
  let testDir: string;
  let originalEnv: string | undefined;
  let originalObservationsCap: string | undefined;
  let originalSignalsRetention: string | undefined;
  let originalFallbackRetention: string | undefined;
  let originalActionsRetention: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    originalObservationsCap = process.env.MODEL_HR_OBSERVATIONS_CAP;
    originalSignalsRetention = process.env.MODEL_HR_SIGNALS_RETENTION_DAYS;
    originalFallbackRetention = process.env.MODEL_HR_FALLBACK_RETENTION_DAYS;
    originalActionsRetention = process.env.MODEL_HR_ACTIONS_RETENTION_DAYS;
    testDir = join(tmpdir(), `model-hr-retention-test-${Date.now()}`);
    process.env.MODEL_HR_DATA_DIR = testDir;
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "observations"), { recursive: true });
    await mkdir(join(testDir, "priors"), { recursive: true });
  });

  afterEach(async () => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
    process.env.MODEL_HR_OBSERVATIONS_CAP = originalObservationsCap;
    process.env.MODEL_HR_SIGNALS_RETENTION_DAYS = originalSignalsRetention;
    process.env.MODEL_HR_FALLBACK_RETENTION_DAYS = originalFallbackRetention;
    process.env.MODEL_HR_ACTIONS_RETENTION_DAYS = originalActionsRetention;
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe("signals retention", () => {
    it("trims old signals when retention is 1 day", async () => {
      process.env.MODEL_HR_SIGNALS_RETENTION_DAYS = "1";
      const oldTs = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(testDir, "signals.jsonl"),
        `${JSON.stringify({ modelId: "old", previousStatus: "a", newStatus: "b", reason: "x", tsISO: oldTs })}\n` +
          `${JSON.stringify({ modelId: "new", previousStatus: "a", newStatus: "b", reason: "y", tsISO: new Date().toISOString() })}\n`,
        "utf-8"
      );
      const signals = await readModelHrSignals(10);
      expect(signals.length).toBe(1);
      expect(signals[0].modelId).toBe("new");
      const { readFile: rf } = await import("fs/promises");
      const afterRaw = await rf(join(testDir, "signals.jsonl"), "utf-8");
      const afterLines = afterRaw.trim().split("\n").filter(Boolean);
      expect(afterLines.length).toBe(1);
    });
  });

  describe("fallback retention", () => {
    it("trims old fallback entries when retention is 1 day", async () => {
      process.env.MODEL_HR_FALLBACK_RETENTION_DAYS = "1";
      const oldTs = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(testDir, "registry-fallback.jsonl"),
        `${JSON.stringify({ tsISO: oldTs, errorSummary: "old" })}\n` +
          `${JSON.stringify({ tsISO: new Date().toISOString(), errorSummary: "new" })}\n`,
        "utf-8"
      );
      const count = await getRegistryFallbackCountLastHours(24);
      expect(count).toBe(1);
      const { readFile } = await import("fs/promises");
      const afterRaw = await readFile(join(testDir, "registry-fallback.jsonl"), "utf-8");
      const afterLines = afterRaw.trim().split("\n").filter(Boolean);
      expect(afterLines.length).toBe(1);
    });
  });

  describe("actions retention", () => {
    it("trims old resolved actions but keeps pending", async () => {
      process.env.MODEL_HR_ACTIONS_RETENTION_DAYS = "1";
      const storage = new InMemoryStorageAdapter([MODEL]);
      const registry = new RegistryService(storage);
      const entry = await enqueueAction("retention-test", "disable", "test", "evaluation");
      expect(entry).not.toBeNull();
      await approveAction(entry!.id, "user", registry);
      const pending = await enqueueAction("retention-test", "probation", "pending", "evaluation");
      expect(pending).not.toBeNull();
      const oldTs = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(
        join(testDir, "actions.jsonl"),
        `${JSON.stringify({ id: "old-resolved", tsISO: oldTs, modelId: "m", action: "disable", reason: "r", recommendedBy: "evaluation", approved: true })}\n` +
          `${JSON.stringify(entry)}\n` +
          `${JSON.stringify(pending)}\n`,
        "utf-8"
      );
      const actions = await listActions(100);
      expect(actions.some((a) => a.id === entry!.id)).toBe(true);
      expect(actions.some((a) => a.id === pending!.id)).toBe(true);
      expect(actions.some((a) => a.id === "old-resolved")).toBe(false);
    });
  });

  describe("observation cap", () => {
    it("respects MODEL_HR_OBSERVATIONS_CAP", async () => {
      process.env.MODEL_HR_OBSERVATIONS_CAP = "200";
      const fileStorage = new FileStorageAdapter(testDir);
      for (let i = 0; i < 250; i++) {
        await fileStorage.appendObservation({
          modelId: "cap-test",
          taskType: "code",
          difficulty: "medium",
          actualCostUSD: 0.01,
          predictedCostUSD: 0.01,
          actualQuality: 0.8,
          predictedQuality: 0.8,
          tsISO: new Date(Date.now() + i * 1000).toISOString(),
        });
      }
      const obs = await fileStorage.loadObservations("cap-test", 500);
      expect(obs.length).toBeLessThanOrEqual(200);
    });
  });
});
