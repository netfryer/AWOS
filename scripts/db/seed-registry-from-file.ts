/**
 * Seed model_registry from existing .data/model-hr/models.json.
 * Run after migrate. Use when switching to PERSISTENCE_DRIVER=db.
 * Usage: PERSISTENCE_DRIVER=db DATABASE_URL=... tsx scripts/db/seed-registry-from-file.ts
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { getDb } from "../../src/lib/db/index.js";
import { modelRegistry } from "../../src/lib/db/schema.js";
import { ModelRegistryEntrySchema } from "../../src/lib/model-hr/schemas.js";

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

async function main() {
  const path = join(getDataDir(), "models.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    console.error("Could not read models.json:", err);
    process.exit(1);
  }
  const parsed = JSON.parse(raw) as unknown[];
  if (!Array.isArray(parsed)) {
    console.error("models.json must be a JSON array");
    process.exit(1);
  }
  const db = getDb();
  let inserted = 0;
  for (const item of parsed) {
    const result = ModelRegistryEntrySchema.safeParse(item);
    if (!result.success) {
      console.warn("Skipping invalid entry:", item);
      continue;
    }
    const entry = result.data;
    const now = new Date();
    await db.insert(modelRegistry).values({
      modelId: entry.id,
      provider: entry.identity.provider,
      status: entry.identity.status,
      payload: entry as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: modelRegistry.modelId,
      set: {
        provider: entry.identity.provider,
        status: entry.identity.status,
        payload: entry as unknown as Record<string, unknown>,
        updatedAt: now,
      },
    });
    inserted++;
  }
  console.log(`Seeded ${inserted} models from ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
