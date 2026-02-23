/**
 * DB-backed storage adapter for Model HR registry.
 * Registry, observations, and priors in PostgreSQL when PERSISTENCE_DRIVER=db.
 */

import { eq, desc, asc, count } from "drizzle-orm";
import type { ModelObservation, ModelPerformancePrior, ModelRegistryEntry } from "../../types.js";
import type { StorageAdapter } from "./types.js";
import { ModelRegistryEntrySchema } from "../../schemas.js";
import { getDb } from "../../../db/index.js";
import { modelRegistry, modelObservations, modelPriors } from "../../../db/schema.js";
import { FileStorageAdapter } from "./fileStorage.js";
import { getObservationsCap } from "../../config.js";

function formatValidationError(id: string | undefined, modelId: string | undefined, err: unknown): string {
  const parts: string[] = [];
  if (id) parts.push(`id=${id}`);
  if (modelId) parts.push(`modelId=${modelId}`);
  const msg = err instanceof Error ? err.message : String(err);
  parts.push(msg.slice(0, 80));
  return `[ModelHR] Invalid registry entry: ${parts.join(" ")}`;
}

export class DbStorageAdapter implements StorageAdapter {
  private readonly fileStorage: FileStorageAdapter;

  constructor(fileDataDir?: string) {
    this.fileStorage = new FileStorageAdapter(fileDataDir);
  }

  async loadModels(): Promise<ModelRegistryEntry[]> {
    try {
      const db = getDb();
      const rows = await db.select().from(modelRegistry);
      const valid: ModelRegistryEntry[] = [];
      for (const row of rows) {
        const payload = row.payload as unknown;
        const result = ModelRegistryEntrySchema.safeParse(payload);
        if (result.success) {
          valid.push(result.data as ModelRegistryEntry);
        } else {
          const entry = payload as { id?: unknown; identity?: { modelId?: unknown } };
          console.warn(
            formatValidationError(
              String(entry?.id ?? "?"),
              String(entry?.identity?.modelId ?? "?"),
              (result.error as { issues?: { message?: string }[] }).issues?.[0]?.message ?? result.error.message
            )
          );
        }
      }
      return valid;
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.loadModels failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  async saveModel(entry: ModelRegistryEntry): Promise<void> {
    const result = ModelRegistryEntrySchema.safeParse(entry);
    if (!result.success) {
      console.warn(
        formatValidationError(
          entry.id,
          entry.identity?.modelId,
          (result.error as { issues?: { message?: string }[] }).issues?.[0]?.message ?? result.error.message
        )
      );
      return;
    }
    try {
      const db = getDb();
      const now = new Date();
      const payload = entry as unknown as Record<string, unknown>;
      await db
        .insert(modelRegistry)
        .values({
          modelId: entry.id,
          provider: entry.identity.provider,
          status: entry.identity.status,
          payload,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: modelRegistry.modelId,
          set: {
            provider: entry.identity.provider,
            status: entry.identity.status,
            payload: entry as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.saveModel failed:", err instanceof Error ? err.message : err);
    }
  }

  async saveModelReplacing(entry: ModelRegistryEntry, oldIdToRemove: string): Promise<void> {
    const result = ModelRegistryEntrySchema.safeParse(entry);
    if (!result.success) {
      console.warn(
        formatValidationError(
          entry.id,
          entry.identity?.modelId,
          (result.error as { issues?: { message?: string }[] }).issues?.[0]?.message ?? result.error.message
        )
      );
      return;
    }
    try {
      const db = getDb();
      await db.delete(modelRegistry).where(eq(modelRegistry.modelId, oldIdToRemove));
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
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.saveModelReplacing failed:", err instanceof Error ? err.message : err);
    }
  }

  async loadObservations(modelId: string, limit: number = 200): Promise<ModelObservation[]> {
    try {
      const db = getDb();
      const rows = await db
        .select({ payload: modelObservations.payload })
        .from(modelObservations)
        .where(eq(modelObservations.modelId, modelId))
        .orderBy(desc(modelObservations.ts))
        .limit(limit);
      return rows.map((r) => r.payload as ModelObservation);
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.loadObservations failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  async appendObservation(obs: ModelObservation): Promise<void> {
    try {
      const db = getDb();
      const ts = new Date(obs.tsISO ?? Date.now());
      await db.insert(modelObservations).values({
        modelId: obs.modelId,
        payload: obs as unknown as Record<string, unknown>,
        ts,
      });
      const cap = getObservationsCap();
      const countResult = await db
        .select({ n: count() })
        .from(modelObservations)
        .where(eq(modelObservations.modelId, obs.modelId));
      const n = Number(countResult[0]?.n ?? 0);
      if (n > cap) {
        const toDelete = await db
          .select({ id: modelObservations.id })
          .from(modelObservations)
          .where(eq(modelObservations.modelId, obs.modelId))
          .orderBy(asc(modelObservations.ts))
          .limit(n - cap);
        for (const row of toDelete) {
          await db.delete(modelObservations).where(eq(modelObservations.id, row.id));
        }
      }
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.appendObservation failed:", err instanceof Error ? err.message : err);
    }
  }

  async loadPriors(modelId: string): Promise<ModelPerformancePrior[]> {
    try {
      const db = getDb();
      const rows = await db
        .select({ payload: modelPriors.payload })
        .from(modelPriors)
        .where(eq(modelPriors.modelId, modelId));
      if (rows.length === 0) return [];
      const p = rows[0].payload;
      return Array.isArray(p) ? (p as ModelPerformancePrior[]) : [];
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.loadPriors failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  async savePriors(modelId: string, priors: ModelPerformancePrior[]): Promise<void> {
    try {
      const db = getDb();
      const now = new Date();
      await db
        .insert(modelPriors)
        .values({
          modelId,
          payload: priors as unknown as Record<string, unknown>[],
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: modelPriors.modelId,
          set: {
            payload: priors as unknown as Record<string, unknown>[],
            updatedAt: now,
          },
        });
    } catch (err) {
      console.warn("[ModelHR] DbStorageAdapter.savePriors failed:", err instanceof Error ? err.message : err);
    }
  }
}
