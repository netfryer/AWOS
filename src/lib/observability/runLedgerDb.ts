/**
 * DB-backed RunLedgerStore. Used when PERSISTENCE_DRIVER=db.
 */

import { eq, desc } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { runLedgers } from "../db/schema.js";
import type {
  RunLedgerStore,
  Ledger,
  LedgerListItem,
  CreateLedgerOptions,
  DecisionRecord,
  RoleExecutionRecord,
  LedgerMeta,
} from "./runLedger.js";

const DECISIONS_CAP = 200;
const LEDGERS_CAP = 200;

export class DbRunLedgerStore implements RunLedgerStore {
  private async pruneLedgers(): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).orderBy(desc(runLedgers.startedAt));
    if (rows.length <= LEDGERS_CAP) return;
    const toDelete = rows.slice(LEDGERS_CAP);
    for (const r of toDelete) {
      await db.delete(runLedgers).where(eq(runLedgers.runSessionId, r.runSessionId));
    }
  }

  async createLedger(runSessionId: string, options?: CreateLedgerOptions): Promise<void> {
    const db = getDb();
    const now = new Date();
    const counts = options?.counts ?? {};
    const base = {
      runSessionId,
      startedAt: now,
      meta: (options?.meta ?? {}) as Record<string, unknown>,
      counts: {
        packagesTotal: counts.packagesTotal ?? 0,
        worker: counts.worker ?? 0,
        qa: counts.qa ?? 0,
      } as Record<string, unknown>,
      costs: { councilUSD: 0, workerUSD: 0, qaUSD: 0, deterministicQaUSD: 0 } as Record<string, unknown>,
      trustDeltas: [] as unknown[],
      variance: { recorded: 0, skipped: 0, skipReasons: {} } as Record<string, unknown>,
      decisions: [] as unknown[],
    };
    try {
      await db.insert(runLedgers)
        .values({
          runSessionId: base.runSessionId,
          startedAt: base.startedAt,
          meta: base.meta,
          counts: base.counts,
          costs: base.costs,
          trustDeltas: base.trustDeltas,
          variance: base.variance,
          decisions: base.decisions,
        })
        .onConflictDoNothing({ target: runLedgers.runSessionId });
      await this.pruneLedgers();
    } catch (e) {
      console.warn("[runLedger] createLedger failed:", e instanceof Error ? e.message : e);
    }
  }

  async recordDecision(runSessionId: string, record: Omit<DecisionRecord, "tsISO">): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return;
    const full: DecisionRecord = { ...record, tsISO: new Date().toISOString() };
    const decisions = (rows[0].decisions as DecisionRecord[]) ?? [];
    decisions.push(full);
    const capped = decisions.length > DECISIONS_CAP ? decisions.slice(-DECISIONS_CAP) : decisions;
    await db.update(runLedgers).set({ decisions: capped as unknown }).where(eq(runLedgers.runSessionId, runSessionId));
  }

  async recordCost(
    runSessionId: string,
    kind: "council" | "worker" | "qa" | "deterministicQa",
    amountUSD: number
  ): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return;
    const costs = (rows[0].costs as Record<string, number>) ?? {};
    const key = kind === "council" ? "councilUSD" : kind === "worker" ? "workerUSD" : kind === "qa" ? "qaUSD" : "deterministicQaUSD";
    costs[key] = (costs[key] ?? 0) + amountUSD;
    await db.update(runLedgers).set({ costs: costs as unknown }).where(eq(runLedgers.runSessionId, runSessionId));
  }

  async recordTrustDelta(
    runSessionId: string,
    modelId: string,
    role: "worker" | "qa",
    before: number,
    after: number
  ): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return;
    const trustDeltas = (rows[0].trustDeltas as Array<{ tsISO: string; modelId: string; role: string; before: number; after: number }>) ?? [];
    trustDeltas.push({
      tsISO: new Date().toISOString(),
      modelId,
      role,
      before,
      after,
    });
    await db.update(runLedgers).set({ trustDeltas: trustDeltas as unknown }).where(eq(runLedgers.runSessionId, runSessionId));
  }

  async recordVarianceRecorded(runSessionId: string): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return;
    const variance = (rows[0].variance as { recorded: number; skipped: number; skipReasons: Record<string, number> }) ?? {
      recorded: 0,
      skipped: 0,
      skipReasons: {},
    };
    variance.recorded += 1;
    await db.update(runLedgers).set({ variance: variance as unknown }).where(eq(runLedgers.runSessionId, runSessionId));
  }

  async recordVarianceSkipped(runSessionId: string, reason: string): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return;
    const variance = (rows[0].variance as { recorded: number; skipped: number; skipReasons: Record<string, number> }) ?? {
      recorded: 0,
      skipped: 0,
      skipReasons: {},
    };
    variance.skipped += 1;
    variance.skipReasons[reason] = (variance.skipReasons[reason] ?? 0) + 1;
    await db.update(runLedgers).set({ variance: variance as unknown }).where(eq(runLedgers.runSessionId, runSessionId));
  }

  async recordBudgetOptimization(runSessionId: string, details: Record<string, unknown>): Promise<void> {
    await this.recordDecision(runSessionId, { type: "BUDGET_OPTIMIZATION", details });
  }

  async recordCouncilPlanningSkipped(runSessionId: string, reason: string): Promise<void> {
    await this.recordBudgetOptimization(runSessionId, { councilPlanningSkipped: true, reason });
  }

  async finalizeLedger(
    runSessionId: string,
    finalMeta?: Partial<LedgerMeta> & { completed?: number; roleExecutions?: RoleExecutionRecord[] }
  ): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return;
    const updates: Record<string, unknown> = { finishedAt: new Date() };
    if (finalMeta) {
      const { completed, roleExecutions, ...meta } = finalMeta;
      const counts = (rows[0].counts as Record<string, unknown>) ?? {};
      if (completed != null) counts.completed = completed;
      if (roleExecutions != null) updates.roleExecutions = roleExecutions;
      updates.counts = counts;
      if (Object.keys(meta).length > 0) {
        updates.meta = { ...(rows[0].meta as Record<string, unknown>), ...meta };
      }
    }
    await db.update(runLedgers).set(updates as Record<string, unknown>).where(eq(runLedgers.runSessionId, runSessionId));
  }

  async getLedger(runSessionId: string): Promise<Ledger | undefined> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).where(eq(runLedgers.runSessionId, runSessionId));
    if (rows.length === 0) return undefined;
    return rowToLedger(rows[0]);
  }

  async listLedgers(): Promise<LedgerListItem[]> {
    const db = getDb();
    const rows = await db.select().from(runLedgers).orderBy(desc(runLedgers.startedAt));
    return rows.map((r) => ({
      runSessionId: r.runSessionId,
      startedAtISO: (r.startedAt as Date).toISOString(),
      finishedAtISO: r.finishedAt ? (r.finishedAt as Date).toISOString() : undefined,
      meta: Object.keys((r.meta as Record<string, unknown>) ?? {}).length > 0 ? (r.meta as LedgerMeta) : undefined,
    }));
  }
}

function rowToLedger(r: (typeof runLedgers.$inferSelect) & { runSessionId: string }): Ledger {
  return {
    runSessionId: r.runSessionId,
    startedAtISO: (r.startedAt as Date).toISOString(),
    finishedAtISO: r.finishedAt ? (r.finishedAt as Date).toISOString() : undefined,
    meta: (r.meta as LedgerMeta) ?? {},
    counts: (r.counts as Ledger["counts"]) ?? { packagesTotal: 0, worker: 0, qa: 0 },
    costs: (r.costs as Ledger["costs"]) ?? { councilUSD: 0, workerUSD: 0, qaUSD: 0, deterministicQaUSD: 0 },
    trustDeltas: (r.trustDeltas as Ledger["trustDeltas"]) ?? [],
    variance: (r.variance as Ledger["variance"]) ?? { recorded: 0, skipped: 0, skipReasons: {} },
    decisions: (r.decisions as Ledger["decisions"]) ?? [],
    roleExecutions: r.roleExecutions as RoleExecutionRecord[] | undefined,
  };
}
