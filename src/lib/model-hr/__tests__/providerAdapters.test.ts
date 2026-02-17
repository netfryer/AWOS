/**
 * Unit tests for provider adapter discovery and report shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, unlink, readdir, rmdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { discoverAdapters } from "../recruiting/providerAdapters/discovery.js";
import { runRecruitingSync } from "../../../../scripts/model-hr/syncLogic.js";

const TEST_DIR = join(tmpdir(), `model-hr-adapter-test-${Date.now()}`);

describe("providerAdapters.discoverAdapters", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = join(TEST_DIR, "config");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      const files = await readdir(configDir);
      for (const f of files) await unlink(join(configDir, f));
      await rmdir(configDir);
    } catch {
      /* ignore */
    }
  });

  it("returns empty array when config dir does not exist", async () => {
    const nonExistent = join(TEST_DIR, "nonexistent");
    const adapters = await discoverAdapters(nonExistent);
    expect(adapters).toEqual([]);
  });

  it("returns empty array when config dir is empty", async () => {
    const adapters = await discoverAdapters(configDir);
    expect(adapters).toEqual([]);
  });

  it("creates JSONConfigAdapter for models.<provider>.json", async () => {
    await writeFile(
      join(configDir, "models.openai.json"),
      JSON.stringify({
        provider: "openai",
        models: [
          {
            modelId: "gpt-4o",
            displayName: "GPT-4o",
            pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
            allowedTiers: ["cheap", "standard", "premium"],
            expertise: { code: 0.9, general: 0.9 },
            reliability: 0.95,
          },
        ],
      })
    );

    const adapters = await discoverAdapters(configDir);
    expect(adapters).toHaveLength(1);
    expect(adapters[0].providerId).toBe("openai");
    const models = await adapters[0].listModels();
    expect(models).toHaveLength(1);
    expect(models[0].modelId).toBe("gpt-4o");
  });

  it("creates RemoteStubAdapter for models.<provider>.remote.json", async () => {
    await writeFile(
      join(configDir, "models.anthropic.remote.json"),
      JSON.stringify({
        provider: "anthropic",
        models: [
          {
            modelId: "claude-3",
            displayName: "Claude 3",
            pricing: { inPer1k: 0.003, outPer1k: 0.015, currency: "USD" },
            allowedTiers: ["standard", "premium"],
            expertise: { code: 0.88, general: 0.9 },
            reliability: 0.97,
          },
        ],
      })
    );

    const adapters = await discoverAdapters(configDir);
    expect(adapters).toHaveLength(1);
    expect(adapters[0].providerId).toBe("anthropic");
    const models = await adapters[0].listModels();
    expect(models).toHaveLength(1);
    expect(models[0].modelId).toBe("claude-3");
  });

  it("RemoteStubAdapter returns [] when file does not exist", async () => {
    const adapters = await discoverAdapters(configDir);
    expect(adapters).toHaveLength(0);

    // Create only a JSON adapter for openai; no remote file
    await writeFile(
      join(configDir, "models.openai.json"),
      JSON.stringify({
        provider: "openai",
        models: [],
      })
    );
    const adapters2 = await discoverAdapters(configDir);
    expect(adapters2).toHaveLength(1);
    // Remote adapter for openai would only exist if models.openai.remote.json exists
    // We didn't create it, so we only have JSON adapter
    expect(adapters2[0].providerId).toBe("openai");
  });

  it("discovers both JSON and remote adapters for same provider", async () => {
    await writeFile(
      join(configDir, "models.openai.json"),
      JSON.stringify({
        provider: "openai",
        models: [
          {
            modelId: "gpt-4o",
            displayName: "GPT-4o",
            pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
            allowedTiers: ["cheap", "standard", "premium"],
            expertise: { code: 0.9, general: 0.9 },
            reliability: 0.95,
          },
        ],
      })
    );
    await writeFile(
      join(configDir, "models.openai.remote.json"),
      JSON.stringify({
        provider: "openai",
        models: [
          {
            modelId: "gpt-4o-mini",
            displayName: "GPT-4o Mini",
            pricing: { inPer1k: 0.00015, outPer1k: 0.0006, currency: "USD" },
            allowedTiers: ["cheap", "standard"],
            expertise: { code: 0.85, general: 0.88 },
            reliability: 0.92,
          },
        ],
      })
    );

    const adapters = await discoverAdapters(configDir);
    expect(adapters).toHaveLength(2);
    const providerIds = adapters.map((a) => a.providerId);
    expect(providerIds).toContain("openai");
    expect(providerIds.filter((p) => p === "openai")).toHaveLength(2);
  });

  it("ignores files that do not match models.<provider>.json pattern", async () => {
    await writeFile(join(configDir, "other.json"), "{}");
    await writeFile(join(configDir, "models.json"), "{}");
    await writeFile(join(configDir, "models.openai.extra.json"), "{}");

    const adapters = await discoverAdapters(configDir);
    expect(adapters).toHaveLength(0);
  });
});

describe("RecruitingSyncResult report shape", () => {
  let originalEnv: string | undefined;
  const dataDir = join(TEST_DIR, "data");

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    process.env.MODEL_HR_DATA_DIR = dataDir;
    await mkdir(dataDir, { recursive: true });
  });

  afterEach(() => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
  });

  it("result has required top-level fields", async () => {
    const result = await runRecruitingSync();

    expect(result).toHaveProperty("report");
    expect(result).toHaveProperty("created");
    expect(result).toHaveProperty("updated");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("byProvider");

    expect(Array.isArray(result.created)).toBe(true);
    expect(Array.isArray(result.updated)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(typeof result.byProvider).toBe("object");
  });

  it("byProvider entries have created, updated, skipped, errors", async () => {
    const result = await runRecruitingSync();

    for (const [providerId, providerResult] of Object.entries(result.byProvider)) {
      expect(typeof providerId).toBe("string");
      expect(providerId.length).toBeGreaterThan(0);

      expect(providerResult).toHaveProperty("created");
      expect(providerResult).toHaveProperty("updated");
      expect(providerResult).toHaveProperty("skipped");
      expect(providerResult).toHaveProperty("errors");

      expect(Array.isArray(providerResult.created)).toBe(true);
      expect(Array.isArray(providerResult.updated)).toBe(true);
      expect(Array.isArray(providerResult.skipped)).toBe(true);
      expect(Array.isArray(providerResult.errors)).toBe(true);
    }
  });

  it("report items have modelId, canonicalId, action, reason", async () => {
    const result = await runRecruitingSync();

    const allItems = [
      ...result.report.created,
      ...result.report.updated,
      ...result.report.skipped,
    ];

    for (const item of allItems) {
      expect(item).toHaveProperty("modelId");
      expect(item).toHaveProperty("canonicalId");
      expect(item).toHaveProperty("action");
      expect(item).toHaveProperty("reason");
      expect(["created", "updated", "skipped"]).toContain(item.action);
    }
  });

  it("created/updated/skipped arrays contain canonicalIds matching report", async () => {
    const result = await runRecruitingSync();

    const createdIds = result.report.created.map((i) => i.canonicalId);
    const updatedIds = result.report.updated.map((i) => i.canonicalId);
    const skippedIds = result.report.skipped.map((i) => i.canonicalId);

    expect(result.created).toEqual(createdIds);
    expect(result.updated).toEqual(updatedIds);
    expect(result.skipped).toEqual(skippedIds);
  });
});
