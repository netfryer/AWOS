/**
 * Run session store for async execution progress.
 * In-memory when file driver; DB-backed when PERSISTENCE_DRIVER=db.
 */

// ─── src/lib/execution/runSessionStore.ts ──────────────────────────────────

import { randomUUID } from "crypto";
import { getPersistenceDriver } from "../persistence/driver.js";
import {
  createRunSessionDb,
  updateRunSessionDb,
  getRunSessionDb,
} from "./runSessionDb.js";

export interface RunSessionProgress {
  totalPackages: number;
  completedPackages: number;
  runningPackages: number;
  warnings: string[];
  partialResult?: {
    runs: unknown[];
    qaResults: unknown[];
    escalations: unknown[];
    budget: { startingUSD: number; remainingUSD: number; escalationSpendUSD: number };
  };
}

export interface RunSession {
  id: string;
  status: "running" | "completed" | "failed";
  progress: RunSessionProgress;
  createdAt: string;
  updatedAt: string;
}

const GLOBAL_SESSIONS_KEY = Symbol.for("runSessionStore");

function getSessions(): Map<string, RunSession> {
  const g = globalThis as unknown as Record<symbol, Map<string, RunSession> | undefined>;
  if (!g[GLOBAL_SESSIONS_KEY]) {
    g[GLOBAL_SESSIONS_KEY] = new Map();
  }
  return g[GLOBAL_SESSIONS_KEY];
}

export function createRunSession(
  initial: Partial<RunSession> & { progress: RunSessionProgress } & { id?: string }
): string {
  const id = initial.id ?? randomUUID();
  const now = new Date().toISOString();
  const session: RunSession = {
    id,
    status: initial.status ?? "running",
    progress: initial.progress,
    createdAt: initial.createdAt ?? now,
    updatedAt: now,
  };
  getSessions().set(id, session);
  if (getPersistenceDriver() === "db") {
    void createRunSessionDb(
      id,
      session.status,
      session.progress,
      new Date(session.createdAt),
      new Date(session.updatedAt)
    );
  }
  return id;
}

export function updateRunSession(id: string, patch: Partial<Pick<RunSession, "status" | "progress">>): void {
  const s = getSessions().get(id);
  if (!s) return;
  if (patch.status != null) s.status = patch.status;
  if (patch.progress != null) {
    const p = patch.progress;
    if (p.totalPackages != null) s.progress.totalPackages = p.totalPackages;
    if (p.completedPackages != null) s.progress.completedPackages = p.completedPackages;
    if (p.runningPackages != null) s.progress.runningPackages = p.runningPackages;
    if (p.warnings != null) {
      s.progress.warnings = [...s.progress.warnings, ...p.warnings];
    }
    if (p.partialResult != null) s.progress.partialResult = p.partialResult;
  }
  s.updatedAt = new Date().toISOString();
  if (getPersistenceDriver() === "db") {
    void updateRunSessionDb(id, patch.status ?? undefined, patch.progress ?? undefined, new Date(s.updatedAt));
  }
}

export function appendWarning(id: string, warning: string): void {
  const s = getSessions().get(id);
  if (!s) return;
  s.progress.warnings.push(warning);
  s.updatedAt = new Date().toISOString();
  if (getPersistenceDriver() === "db") {
    void updateRunSessionDb(id, undefined, { warnings: [warning] } as Partial<RunSessionProgress>, new Date(s.updatedAt));
  }
}

export function getRunSession(id: string): RunSession | undefined {
  return getSessions().get(id);
}

/** Async getter: checks memory first, then DB when PERSISTENCE_DRIVER=db. */
export async function getRunSessionAsync(id: string): Promise<RunSession | undefined> {
  const mem = getSessions().get(id);
  if (mem) return mem;
  if (getPersistenceDriver() === "db") {
    return getRunSessionDb(id);
  }
  return undefined;
}
