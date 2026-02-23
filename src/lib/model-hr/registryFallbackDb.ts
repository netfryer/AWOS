/**
 * DB-backed registry fallback events. Used when PERSISTENCE_DRIVER=db.
 */

import { count, gte } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { registryFallbackEvents } from "../db/schema.js";

/**
 * Record a fallback event. Never throws.
 */
export async function recordRegistryFallbackDb(errorSummary?: string): Promise<void> {
  try {
    const db = getDb();
    await db.insert(registryFallbackEvents).values({
      ts: new Date(),
      reason: errorSummary ?? null,
      details: null,
    });
  } catch (err) {
    console.warn("[ModelHR] recordRegistryFallbackDb failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Count fallback events in the last N hours.
 */
export async function getRegistryFallbackCountLastHoursDb(hours: number = 24): Promise<number> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db
      .select({ count: count() })
      .from(registryFallbackEvents)
      .where(gte(registryFallbackEvents.ts, cutoff));
    return result[0]?.count ?? 0;
  } catch {
    return 0;
  }
}
