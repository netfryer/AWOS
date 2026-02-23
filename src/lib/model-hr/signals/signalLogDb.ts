/**
 * DB-backed Model HR signal log. Used when PERSISTENCE_DRIVER=db.
 */

import { desc, eq, and, gte } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { modelHrSignals } from "../../db/schema.js";
import { getSignalsRetentionDays } from "../config.js";
import type { ModelHrSignal } from "./signalLog.js";

export async function emitModelHrSignalDb(signal: ModelHrSignal): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    await db.insert(modelHrSignals).values({
      modelId: signal.modelId,
      payload: signal as unknown as Record<string, unknown>,
      ts: now,
    });
  } catch {
    /* swallow - no run failure */
  }
}

export async function readModelHrSignalsDb(limit: number = 100): Promise<ModelHrSignal[]> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - getSignalsRetentionDays() * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ payload: modelHrSignals.payload })
      .from(modelHrSignals)
      .where(gte(modelHrSignals.ts, cutoff))
      .orderBy(desc(modelHrSignals.ts))
      .limit(limit);
    const parsed = rows
      .map((r) => r.payload as ModelHrSignal)
      .filter((p) => p?.modelId && p?.reason && p?.tsISO);
    return parsed;
  } catch {
    return [];
  }
}

export async function readModelHrSignalsForModelDb(
  modelId: string,
  limit: number = 50
): Promise<ModelHrSignal[]> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - getSignalsRetentionDays() * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ payload: modelHrSignals.payload })
      .from(modelHrSignals)
      .where(and(eq(modelHrSignals.modelId, modelId), gte(modelHrSignals.ts, cutoff)))
      .orderBy(desc(modelHrSignals.ts))
      .limit(limit);
    return rows
      .map((r) => r.payload as ModelHrSignal)
      .filter((p) => p?.modelId && p?.reason && p?.tsISO);
  } catch {
    return [];
  }
}
