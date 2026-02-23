/**
 * DB-backed app config (key-value). Used for portfolio mode, tuning, etc.
 * PERSISTENCE_DRIVER=db.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./index.js";
import { appConfig } from "./schema.js";

export async function getAppConfigDb(key: string): Promise<unknown> {
  try {
    const db = getDb();
    const rows = await db.select().from(appConfig).where(eq(appConfig.key, key));
    if (rows.length === 0) return undefined;
    const v = rows[0].value as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && "v" in v && Object.keys(v).length === 1) {
      return (v as { v: unknown }).v;
    }
    return v;
  } catch {
    return undefined;
  }
}

export async function setAppConfigDb(key: string, value: unknown): Promise<void> {
  const db = getDb();
  const now = new Date();
  const jsonVal =
    value !== undefined && value !== null
      ? (typeof value === "object" ? value : { v: value })
      : {};
  const toStore = (typeof jsonVal === "object" && jsonVal !== null ? jsonVal : { v: jsonVal }) as Record<
    string,
    unknown
  >;
  await db
    .insert(appConfig)
    .values({
      key,
      value: toStore,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: toStore,
        updatedAt: now,
      },
    });
}
