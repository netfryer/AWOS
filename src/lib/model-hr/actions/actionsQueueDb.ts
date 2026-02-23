/**
 * DB-backed HR Actions Queue. Used when PERSISTENCE_DRIVER=db.
 */

import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { modelHrActions } from "../../db/schema.js";
import { getActionsRetentionDays } from "../config.js";
import type { HrAction, HrActionType, HrActionRecommendedBy } from "./actionsQueue.js";

function isPending(a: HrAction): boolean {
  return !a.approved && !a.rejectedBy;
}

export async function enqueueActionDb(
  modelId: string,
  action: HrActionType,
  reason: string,
  recommendedBy: HrActionRecommendedBy
): Promise<HrAction | null> {
  try {
    const db = getDb();
    const now = new Date();
    const entry: HrAction = {
      id: randomUUID(),
      tsISO: now.toISOString(),
      modelId,
      action,
      reason,
      recommendedBy,
      approved: false,
    };
    await db.insert(modelHrActions).values({
      id: entry.id,
      modelId: entry.modelId,
      payload: entry as unknown as Record<string, unknown>,
      ts: now,
    });
    return entry;
  } catch {
    return null;
  }
}

export async function listActionsDb(limit: number = 100): Promise<HrAction[]> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - getActionsRetentionDays() * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ payload: modelHrActions.payload })
      .from(modelHrActions)
      .orderBy(desc(modelHrActions.ts))
      .limit(limit * 2);
    const parsed: HrAction[] = [];
    for (const r of rows) {
      const a = r.payload as HrAction;
      if (
        a?.id &&
        a?.modelId &&
        a?.action &&
        a?.reason &&
        a?.recommendedBy &&
        typeof a.approved === "boolean"
      ) {
        const ts = a.tsISO ?? "";
        if (isPending(a) || ts >= cutoff.toISOString()) {
          parsed.push(a);
        }
      }
      if (parsed.length >= limit) break;
    }
    return parsed;
  } catch {
    return [];
  }
}

export async function getActionByIdDb(id: string): Promise<HrAction | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ payload: modelHrActions.payload })
      .from(modelHrActions)
      .where(eq(modelHrActions.id, id));
    if (rows.length === 0) return null;
    const a = rows[0].payload as HrAction;
    if (
      a?.id &&
      a?.modelId &&
      a?.action &&
      a?.reason &&
      a?.recommendedBy &&
      typeof a.approved === "boolean"
    ) {
      return a;
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateActionDb(
  id: string,
  updater: (a: HrAction) => HrAction
): Promise<HrAction | null> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(modelHrActions)
      .where(eq(modelHrActions.id, id));
    if (rows.length === 0) return null;
    const current = rows[0].payload as HrAction;
    const updated = updater(current);
    await db
      .update(modelHrActions)
      .set({
        payload: updated as unknown as Record<string, unknown>,
        ts: new Date(updated.tsISO ?? Date.now()),
      })
      .where(eq(modelHrActions.id, id));
    return updated;
  } catch {
    return null;
  }
}
