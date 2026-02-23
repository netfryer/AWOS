/**
 * DB-backed demo runs store. Used when PERSISTENCE_DRIVER=db.
 */

import { eq, desc, gte } from "drizzle-orm";
import { getDb } from "../../src/lib/db/index.js";
import { demoRuns } from "../../src/lib/db/schema.js";
import type {
  DemoRunPayload,
  DemoRunListItem,
  DemoRunWithRoleExecutions,
  RoleExecutionRecord,
} from "./demoRunsStore.js";

export async function saveDemoRunDb(id: string, payload: DemoRunPayload): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    await db
      .insert(demoRuns)
      .values({
        runSessionId: id,
        timestamp: payload.timestamp,
        payload: payload as unknown as Record<string, unknown>,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: demoRuns.runSessionId,
        set: {
          timestamp: payload.timestamp,
          payload: payload as unknown as Record<string, unknown>,
        },
      });
  } catch (e) {
    console.warn("[demoRunsStore] saveDemoRun (db) failed:", e instanceof Error ? e.message : e);
  }
}

export async function loadDemoRunDb(id: string): Promise<DemoRunPayload | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(demoRuns).where(eq(demoRuns.runSessionId, id));
    if (rows.length === 0) return null;
    const p = rows[0].payload as DemoRunPayload;
    if (p?.runSessionId) return p;
    return null;
  } catch {
    return null;
  }
}

export async function listDemoRunsDb(limit = 20): Promise<DemoRunListItem[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        runSessionId: demoRuns.runSessionId,
        timestamp: demoRuns.timestamp,
        payload: demoRuns.payload,
      })
      .from(demoRuns)
      .orderBy(desc(demoRuns.timestamp))
      .limit(limit * 2);

    const items: DemoRunListItem[] = [];
    for (const r of rows) {
      const parsed = r.payload as DemoRunPayload;
      if (!parsed?.runSessionId) continue;
      const budget = parsed.result?.budget;
      const costs = parsed.bundle?.ledger?.costs as Record<string, number> | undefined;
      const cost =
        budget != null
          ? budget.startingUSD - (budget.remainingUSD ?? 0)
          : costs
            ? (costs.councilUSD ?? 0) + (costs.workerUSD ?? 0) + (costs.qaUSD ?? 0) + (costs.deterministicQaUSD ?? 0)
            : undefined;
      const qaResults = parsed.result?.qaResults ?? [];
      const qaPass = qaResults.length > 0 ? qaResults.every((q) => q.pass) : undefined;
      items.push({
        id: parsed.runSessionId,
        ts: parsed.timestamp ?? "",
        cost,
        qaPass,
      });
      if (items.length >= limit) break;
    }
    return items;
  } catch {
    return [];
  }
}

export async function listDemoRunsForRolesDb(
  hours: number,
  limit: number
): Promise<DemoRunWithRoleExecutions[]> {
  try {
    const db = getDb();
    const cutoff = hours > 0 ? new Date(Date.now() - hours * 60 * 60 * 1000) : null;
    const rows = cutoff
      ? await db
          .select({
            runSessionId: demoRuns.runSessionId,
            timestamp: demoRuns.timestamp,
            payload: demoRuns.payload,
          })
          .from(demoRuns)
          .where(gte(demoRuns.createdAt, cutoff))
          .orderBy(desc(demoRuns.timestamp))
          .limit(limit)
      : await db
          .select({
            runSessionId: demoRuns.runSessionId,
            timestamp: demoRuns.timestamp,
            payload: demoRuns.payload,
          })
          .from(demoRuns)
          .orderBy(desc(demoRuns.timestamp))
          .limit(limit);

    const items: DemoRunWithRoleExecutions[] = [];
    for (const r of rows) {
      const parsed = r.payload as DemoRunPayload;
      const roleExecutions: RoleExecutionRecord[] =
        (parsed.result as { roleExecutions?: RoleExecutionRecord[] } | undefined)?.roleExecutions ??
        (parsed.bundle?.ledger as { roleExecutions?: RoleExecutionRecord[] } | undefined)
          ?.roleExecutions ??
        [];
      items.push({
        runSessionId: parsed.runSessionId ?? r.runSessionId,
        timestamp: parsed.timestamp ?? r.timestamp,
        roleExecutions,
      });
    }
    return items;
  } catch {
    return [];
  }
}
