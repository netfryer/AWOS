/**
 * In-memory run session store for async execution progress.
 */

// ─── src/lib/execution/runSessionStore.ts ──────────────────────────────────

import { randomUUID } from "crypto";

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
}

export function appendWarning(id: string, warning: string): void {
  const s = getSessions().get(id);
  if (!s) return;
  s.progress.warnings.push(warning);
  s.updatedAt = new Date().toISOString();
}

export function getRunSession(id: string): RunSession | undefined {
  return getSessions().get(id);
}
