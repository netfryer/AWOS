/**
 * Tests for FileStorageAdapter validation: loadModels never throws,
 * invalid entries are skipped, malformed JSON returns [].
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FileStorageAdapter } from "../registry/storage/fileStorage.js";
import type { ModelRegistryEntry } from "../types.js";

describe("FileStorageAdapter validation", () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    testDir = join(tmpdir(), `model-hr-filestorage-validation-${Date.now()}`);
    process.env.MODEL_HR_DATA_DIR = testDir;
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "observations"), { recursive: true });
    await mkdir(join(testDir, "priors"), { recursive: true });
  });

  afterEach(async () => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("loadModels returns [] when models.json is missing", async () => {
    const storage = new FileStorageAdapter(testDir);
    const models = await storage.loadModels();
    expect(models).toEqual([]);
  });

  it("loadModels returns [] when JSON is malformed", async () => {
    await writeFile(join(testDir, "models.json"), "{ invalid json }", "utf-8");
    const storage = new FileStorageAdapter(testDir);
    const models = await storage.loadModels();
    expect(models).toEqual([]);
  });

  it("loadModels returns [] when root is not an array", async () => {
    await writeFile(join(testDir, "models.json"), '{"foo": "bar"}', "utf-8");
    const storage = new FileStorageAdapter(testDir);
    const models = await storage.loadModels();
    expect(models).toEqual([]);
  });

  it("loadModels returns only valid entries when mixed valid/invalid", async () => {
    const valid: ModelRegistryEntry = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };
    const invalid1 = { id: "bad", identity: { provider: "", modelId: "x", status: "active" }, pricing: { inPer1k: 0, outPer1k: 0 }, createdAtISO: "x", updatedAtISO: "x" };
    const invalid2 = { id: "also-bad", identity: null, pricing: {} };
    await writeFile(
      join(testDir, "models.json"),
      JSON.stringify([valid, invalid1, invalid2]),
      "utf-8"
    );
    const storage = new FileStorageAdapter(testDir);
    const models = await storage.loadModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("openai/gpt-4o");
  });

  it("loadModels never throws on read error", async () => {
    const storage = new FileStorageAdapter(join(testDir, "nonexistent-nested", "deeper"));
    const models = await storage.loadModels();
    expect(models).toEqual([]);
  });

  it("saveModel does not write invalid entry", async () => {
    const modelsPath = join(testDir, "models.json");
    const invalid = {
      id: "bad",
      identity: { provider: "", modelId: "x", status: "active" },
      pricing: { inPer1k: 0, outPer1k: 0 },
      createdAtISO: "x",
      updatedAtISO: "x",
    } as unknown as ModelRegistryEntry;
    const valid: ModelRegistryEntry = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const storage = new FileStorageAdapter(testDir);

      // Case 1: No pre-existing file. saveModel(invalid) must not create models.json with invalid.
      await storage.saveModel(invalid);
      let models = await storage.loadModels();
      expect(models).toEqual([]);

      // Case 2: Pre-existing valid data. saveModel(invalid) must not overwrite or add invalid.
      await storage.saveModel(valid);
      await storage.saveModel(invalid);
      models = await storage.loadModels();
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe("openai/gpt-4o");

      const raw = await readFile(modelsPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
      const ids = (parsed as { id?: string }[]).map((m) => m?.id);
      expect(ids).not.toContain("bad");

      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls.some((c) => String(c[0] ?? "").includes("[ModelHR]"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("saveModel writes valid entry", async () => {
    const storage = new FileStorageAdapter(testDir);
    const valid: ModelRegistryEntry = {
      id: "openai/gpt-4o",
      identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
      pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
      createdAtISO: "2025-01-01T00:00:00.000Z",
      updatedAtISO: "2025-01-01T00:00:00.000Z",
    };
    await storage.saveModel(valid);
    const models = await storage.loadModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("openai/gpt-4o");
  });
});
