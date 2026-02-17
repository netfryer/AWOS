#!/usr/bin/env node
/**
 * Seed models.json if missing.
 * Converts SAMPLE_MODELS (ModelSpec) to ModelRegistryEntry and writes to .data/model-hr/models.json.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { SAMPLE_MODELS } from "../../src/demoModels.js";
import type { ModelRegistryEntry } from "../../src/lib/model-hr/types.js";

function getDataDir(): string {
  const envDir = process.env.MODEL_HR_DATA_DIR;
  if (envDir) return envDir;
  return join(process.cwd(), ".data", "model-hr");
}

function modelSpecToRegistryEntry(spec: {
  id: string;
  displayName?: string;
  expertise?: Record<string, number>;
  pricing: { inPer1k: number; outPer1k: number };
  reliability?: number;
}): ModelRegistryEntry {
  const now = new Date().toISOString();
  const provider = spec.id.startsWith("gpt") ? "openai" : spec.id.startsWith("claude") ? "anthropic" : "unknown";
  return {
    id: spec.id,
    identity: {
      provider,
      modelId: spec.id,
      status: "active",
    },
    displayName: spec.displayName ?? spec.id,
    pricing: {
      inPer1k: spec.pricing.inPer1k,
      outPer1k: spec.pricing.outPer1k,
      currency: "USD",
    },
    expertise: spec.expertise ?? { general: 0.7, code: 0.7, writing: 0.7, analysis: 0.7 },
    reliability: spec.reliability ?? 0.7,
    createdAtISO: now,
    updatedAtISO: now,
  };
}

async function main(): Promise<void> {
  const dataDir = getDataDir();
  const modelsPath = join(dataDir, "models.json");

  try {
    await readFile(modelsPath, "utf-8");
    console.log(`[seed] models.json exists at ${modelsPath}, skipping seed`);
    process.exit(0);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      console.error("[seed] Failed to check models.json:", e.message);
      process.exit(1);
    }
  }

  try {
    await mkdir(dataDir, { recursive: true });
    const entries = SAMPLE_MODELS.map(modelSpecToRegistryEntry);
    await writeFile(modelsPath, JSON.stringify(entries, null, 2), "utf-8");
    console.log(`[seed] Created ${modelsPath} with ${entries.length} models`);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error("[seed] Failed to seed models.json:", e.message);
    process.exit(1);
  }
}

main();
