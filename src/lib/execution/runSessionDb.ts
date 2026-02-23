/**
 * DB-backed run session store. Used when PERSISTENCE_DRIVER=db.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { runSessions } from "../db/schema.js";
import type { RunSession, RunSessionProgress } from "./runSessionStore.js";

export async function createRunSessionDb(
  id: string,
  status: string,
  progress: RunSessionProgress,
  createdAt: Date,
  updatedAt: Date
): Promise<void> {
  const db = getDb();
  await db.insert(runSessions).values({
    id,
    status,
    progress: progress as unknown as Record<string, unknown>,
    createdAt,
    updatedAt,
  });
}

export async function updateRunSessionDb(
  id: string,
  status: string | undefined,
  progress: Partial<RunSessionProgress> | undefined,
  updatedAt: Date
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(runSessions).where(eq(runSessions.id, id));
  if (rows.length === 0) return;
  const current = rows[0];
  const newStatus = status ?? current.status;
  let newProgress = current.progress as RunSessionProgress;
  if (progress) {
    newProgress = {
      ...newProgress,
      totalPackages: progress.totalPackages ?? newProgress.totalPackages,
      completedPackages: progress.completedPackages ?? newProgress.completedPackages,
      runningPackages: progress.runningPackages ?? newProgress.runningPackages,
      warnings: progress.warnings != null ? [...(newProgress.warnings ?? []), ...progress.warnings] : newProgress.warnings,
      partialResult: progress.partialResult ?? newProgress.partialResult,
    };
  }
  await db
    .update(runSessions)
    .set({
      status: newStatus,
      progress: newProgress as unknown as Record<string, unknown>,
      updatedAt,
    })
    .where(eq(runSessions.id, id));
}

export async function getRunSessionDb(id: string): Promise<RunSession | undefined> {
  const db = getDb();
  const rows = await db.select().from(runSessions).where(eq(runSessions.id, id));
  if (rows.length === 0) return undefined;
  const r = rows[0];
  return {
    id: r.id,
    status: r.status as "running" | "completed" | "failed",
    progress: r.progress as RunSessionProgress,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
