/**
 * In-memory RunLedger for observability: compact decision records,
 * costs, trust deltas, variance stats. No prompts or artifact contents.
 */

// ─── src/lib/observability/runLedger.ts ──────────────────────────────────────

import { getPersistenceDriver } from "../persistence/driver.js";
import { DbRunLedgerStore } from "./runLedgerDb.js";

export type DecisionType = "ROUTE" | "AUDIT_PATCH" | "ESCALATION" | "BUDGET_OPTIMIZATION" | "MODEL_HR_SIGNAL" | "PROCUREMENT_FALLBACK" | "ASSEMBLY" | "ASSEMBLY_FAILED";

/** Stage 7.1: Role execution record for RBEG. */
export interface RoleExecutionRecord {
  nodeId: string;
  role: "ceo" | "executive" | "manager" | "worker" | "qa";
  modelId?: string;
  costUSD?: number;
  score?: number;
  status: "ok" | "retry" | "fail";
  /** Optional failure reason (e.g. validation error message). */
  notes?: string;
}

export interface DecisionRecord {
  tsISO: string;
  type: DecisionType;
  packageId?: string;
  details: Record<string, unknown>;
}

export interface LedgerMeta {
  directiveHash?: string;
  planId?: string;
  riskScore?: number;
  planConfidence?: number;
}

export interface Ledger {
  runSessionId: string;
  startedAtISO: string;
  finishedAtISO?: string;
  meta: LedgerMeta;
  counts: {
    packagesTotal: number;
    worker: number;
    qa: number;
    completed?: number;
  };
  costs: {
    councilUSD: number;
    workerUSD: number;
    qaUSD: number;
    deterministicQaUSD: number;
  };
  trustDeltas: Array<{
    tsISO: string;
    modelId: string;
    role: "worker" | "qa";
    before: number;
    after: number;
  }>;
  variance: {
    recorded: number;
    skipped: number;
    skipReasons: Record<string, number>;
  };
  decisions: DecisionRecord[];
  /** Stage 7.1: Role executions (CEO → Manager → Worker → QA). */
  roleExecutions?: RoleExecutionRecord[];
}

const DECISIONS_CAP = 200;

export interface CreateLedgerOptions {
  meta?: LedgerMeta;
  counts?: { packagesTotal?: number; worker?: number; qa?: number };
}

export interface LedgerListItem {
  runSessionId: string;
  startedAtISO: string;
  finishedAtISO?: string;
  meta?: LedgerMeta;
}

export interface RunLedgerStore {
  createLedger(runSessionId: string, options?: CreateLedgerOptions): void | Promise<void>;
  recordDecision(runSessionId: string, record: Omit<DecisionRecord, "tsISO">): void | Promise<void>;
  recordCost(runSessionId: string, kind: "council" | "worker" | "qa" | "deterministicQa", amountUSD: number): void | Promise<void>;
  recordTrustDelta(
    runSessionId: string,
    modelId: string,
    role: "worker" | "qa",
    before: number,
    after: number
  ): void | Promise<void>;
  recordVarianceRecorded(runSessionId: string): void | Promise<void>;
  recordVarianceSkipped(runSessionId: string, reason: string): void | Promise<void>;
  recordBudgetOptimization(runSessionId: string, details: Record<string, unknown>): void | Promise<void>;
  recordCouncilPlanningSkipped(runSessionId: string, reason: string): void | Promise<void>;
  finalizeLedger(runSessionId: string, finalMeta?: Partial<LedgerMeta> & { completed?: number; roleExecutions?: RoleExecutionRecord[] }): void | Promise<void>;
  getLedger(runSessionId: string): Ledger | undefined | Promise<Ledger | undefined>;
  listLedgers(): LedgerListItem[] | Promise<LedgerListItem[]>;
}

const LEDGERS_CAP = 200;

class InMemoryRunLedgerStore implements RunLedgerStore {
  private ledgers = new Map<string, Ledger>();

  private pruneLedgers(): void {
    if (this.ledgers.size <= LEDGERS_CAP) return;
    const entries = [...this.ledgers.entries()].map(([id, l]) => ({ id, ledger: l }));
    const completed = entries.filter((e) => e.ledger.finishedAtISO != null);
    const incomplete = entries.filter((e) => e.ledger.finishedAtISO == null);
    completed.sort((a, b) =>
      (a.ledger.finishedAtISO ?? "").localeCompare(b.ledger.finishedAtISO ?? "")
    );
    const toDrop = completed.slice(0, this.ledgers.size - LEDGERS_CAP);
    for (const { id } of toDrop) {
      this.ledgers.delete(id);
    }
  }

  createLedger(runSessionId: string, options?: CreateLedgerOptions): void {
    if (this.ledgers.has(runSessionId)) return;
    const now = new Date().toISOString();
    const counts = options?.counts ?? {};
    this.ledgers.set(runSessionId, {
      runSessionId,
      startedAtISO: now,
      meta: options?.meta ?? {},
      counts: {
        packagesTotal: counts.packagesTotal ?? 0,
        worker: counts.worker ?? 0,
        qa: counts.qa ?? 0,
      },
      costs: { councilUSD: 0, workerUSD: 0, qaUSD: 0, deterministicQaUSD: 0 },
      trustDeltas: [],
      variance: { recorded: 0, skipped: 0, skipReasons: {} },
      decisions: [],
    });
    this.pruneLedgers();
  }

  recordDecision(runSessionId: string, record: Omit<DecisionRecord, "tsISO">): void {
    const ledger = this.ledgers.get(runSessionId);
    if (!ledger) return;
    const full: DecisionRecord = { ...record, tsISO: new Date().toISOString() };
    ledger.decisions.push(full);
    if (ledger.decisions.length > DECISIONS_CAP) {
      ledger.decisions = ledger.decisions.slice(-DECISIONS_CAP);
    }
  }

  recordCost(runSessionId: string, kind: "council" | "worker" | "qa" | "deterministicQa", amountUSD: number): void {
    const ledger = this.ledgers.get(runSessionId);
    if (!ledger) return;
    const key = kind === "council" ? "councilUSD" : kind === "worker" ? "workerUSD" : kind === "qa" ? "qaUSD" : "deterministicQaUSD";
    ledger.costs[key] += amountUSD;
  }

  recordTrustDelta(
    runSessionId: string,
    modelId: string,
    role: "worker" | "qa",
    before: number,
    after: number
  ): void {
    const ledger = this.ledgers.get(runSessionId);
    if (!ledger) return;
    ledger.trustDeltas.push({
      tsISO: new Date().toISOString(),
      modelId,
      role,
      before,
      after,
    });
  }

  recordVarianceRecorded(runSessionId: string): void {
    const ledger = this.ledgers.get(runSessionId);
    if (!ledger) return;
    ledger.variance.recorded += 1;
  }

  recordVarianceSkipped(runSessionId: string, reason: string): void {
    const ledger = this.ledgers.get(runSessionId);
    if (!ledger) return;
    ledger.variance.skipped += 1;
    ledger.variance.skipReasons[reason] = (ledger.variance.skipReasons[reason] ?? 0) + 1;
  }

  recordBudgetOptimization(runSessionId: string, details: Record<string, unknown>): void {
    this.recordDecision(runSessionId, {
      type: "BUDGET_OPTIMIZATION",
      details,
    });
  }

  recordCouncilPlanningSkipped(runSessionId: string, reason: string): void {
    this.recordBudgetOptimization(runSessionId, {
      councilPlanningSkipped: true,
      reason,
    });
  }

  finalizeLedger(runSessionId: string, finalMeta?: Partial<LedgerMeta> & { completed?: number; roleExecutions?: RoleExecutionRecord[] }): void {
    const ledger = this.ledgers.get(runSessionId);
    if (!ledger) return;
    ledger.finishedAtISO = new Date().toISOString();
    if (finalMeta) {
      const { completed, roleExecutions, ...meta } = finalMeta;
      if (completed != null) ledger.counts.completed = completed;
      if (roleExecutions != null) ledger.roleExecutions = roleExecutions;
      if (!roleExecutions || (Array.isArray(roleExecutions) && roleExecutions.length === 0)) {
        console.warn(`[runLedger] finalizeLedger(${runSessionId}): roleExecutions missing or empty; RBEG telemetry may be incomplete`);
      }
      if (Object.keys(meta).length > 0) {
        ledger.meta = { ...ledger.meta, ...meta };
      }
    }
  }

  getLedger(runSessionId: string): Ledger | undefined {
    return this.ledgers.get(runSessionId);
  }

  listLedgers(): LedgerListItem[] {
    const items: LedgerListItem[] = [];
    for (const ledger of this.ledgers.values()) {
      items.push({
        runSessionId: ledger.runSessionId,
        startedAtISO: ledger.startedAtISO,
        finishedAtISO: ledger.finishedAtISO,
        meta: Object.keys(ledger.meta).length > 0 ? ledger.meta : undefined,
      });
    }
    items.sort((a, b) => b.startedAtISO.localeCompare(a.startedAtISO));
    return items;
  }
}

const GLOBAL_STORE_KEY = Symbol.for("runLedgerStore");

export function getRunLedgerStore(): RunLedgerStore {
  const g = globalThis as unknown as Record<symbol, RunLedgerStore | undefined>;
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] =
      getPersistenceDriver() === "db" ? new DbRunLedgerStore() : new InMemoryRunLedgerStore();
  }
  return g[GLOBAL_STORE_KEY];
}

/** Lightweight helper: logs BUDGET_OPTIMIZATION decision when council planning is skipped. */
export function recordCouncilPlanningSkipped(runSessionId: string, reason: string): void {
  void Promise.resolve(getRunLedgerStore().recordCouncilPlanningSkipped(runSessionId, reason));
}

/** Async helpers for stores that may return Promises (DB-backed). */
export async function getLedgerAsync(runSessionId: string): Promise<Ledger | undefined> {
  return Promise.resolve(getRunLedgerStore().getLedger(runSessionId));
}
export async function listLedgersAsync(): Promise<LedgerListItem[]> {
  return Promise.resolve(getRunLedgerStore().listLedgers());
}
