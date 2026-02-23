/**
 * HR Actions Queue: records recommended actions requiring approval.
 * File-backed (.data/model-hr/actions.jsonl) or DB-backed when PERSISTENCE_DRIVER=db.
 * Queue writes never throw - failures are swallowed to avoid breaking runs.
 */

import { appendFile, readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { emitModelHrSignal } from "../signals/signalLog.js";
import { getActionsRetentionDays } from "../config.js";
import { getPersistenceDriver } from "../../persistence/driver.js";
import {
  enqueueActionDb,
  listActionsDb,
  getActionByIdDb,
  updateActionDb,
} from "./actionsQueueDb.js";

export type HrActionType = "probation" | "disable" | "activate" | "kill_switch";
export type HrActionRecommendedBy = "evaluation" | "ops";

export interface HrAction {
  id: string;
  tsISO: string;
  modelId: string;
  action: HrActionType;
  reason: string;
  recommendedBy: HrActionRecommendedBy;
  approved: boolean;
  approvedBy?: string;
  approvedAtISO?: string;
  rejectedBy?: string;
  rejectedAtISO?: string;
  rejectionReason?: string;
}

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

function getActionsPath(): string {
  return join(getDataDir(), "actions.jsonl");
}

async function ensureDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

function parseLine(line: string): HrAction | null {
  try {
    const obj = JSON.parse(line) as HrAction;
    if (obj.id && obj.modelId && obj.action && obj.reason && obj.recommendedBy && typeof obj.approved === "boolean") {
      return obj;
    }
  } catch {
    /* skip malformed */
  }
  return null;
}

function isPending(a: HrAction): boolean {
  return !a.approved && !a.rejectedBy;
}

/**
 * Append an action to the queue. Never throws.
 */
export async function enqueueAction(
  modelId: string,
  action: HrActionType,
  reason: string,
  recommendedBy: HrActionRecommendedBy
): Promise<HrAction | null> {
  const entry: HrAction = {
    id: randomUUID(),
    tsISO: new Date().toISOString(),
    modelId,
    action,
    reason,
    recommendedBy,
    approved: false,
  };
  try {
    await ensureDir();
    await appendFile(getActionsPath(), JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read actions from the queue (most recent first). Returns [] on error.
 * Trims resolved actions older than retention; pending actions always kept.
 */
export async function listActions(limit: number = 100): Promise<HrAction[]> {
  if (getPersistenceDriver() === "db") {
    return listActionsDb(limit);
  }
  try {
    const path = getActionsPath();
    const raw = await readFile(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const cutoff = new Date(Date.now() - getActionsRetentionDays() * 24 * 60 * 60 * 1000).toISOString();
    const parsed: HrAction[] = [];
    const retainedLines: string[] = [];
    for (const line of lines) {
      const a = parseLine(line);
      if (a) {
        const keep = isPending(a) || (a.tsISO >= cutoff);
        if (keep) {
          parsed.push(a);
          retainedLines.push(line);
        }
      }
    }
    if (retainedLines.length < lines.length) {
      try {
        await writeFile(path, retainedLines.map((l) => l + "\n").join(""), "utf-8");
      } catch {
        console.warn("[ModelHR] Failed to trim actions.jsonl");
      }
    }
    parsed.sort((a, b) => (a.tsISO ?? "").localeCompare(b.tsISO ?? ""));
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Get a single action by id. Returns null if not found.
 */
export async function getActionById(id: string): Promise<HrAction | null> {
  if (getPersistenceDriver() === "db") {
    return getActionByIdDb(id);
  }
  const all = await listActions(5000);
  return all.find((a) => a.id === id) ?? null;
}

/**
 * Update an action in place (approve or reject). Idempotent: approving twice is safe.
 * Returns the updated action or null on error.
 */
async function updateAction(
  id: string,
  updater: (a: HrAction) => HrAction
): Promise<HrAction | null> {
  if (getPersistenceDriver() === "db") {
    return updateActionDb(id, updater);
  }
  try {
    const path = getActionsPath();
    const raw = await readFile(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    let result: HrAction | null = null;
    const outLines: string[] = [];
    for (const line of lines) {
      const a = parseLine(line);
      if (a && a.id === id) {
        const updated = updater(a);
        outLines.push(JSON.stringify(updated));
        result = updated;
      } else if (a) {
        outLines.push(line);
      }
    }
    if (!result) return null;
    await writeFile(path, outLines.map((l) => l + "\n").join(""), "utf-8");
    return result;
  } catch {
    return null;
  }
}

/**
 * Approve an action and apply the status change. Idempotent.
 */
export async function approveAction(
  id: string,
  approvedBy: string,
  registry: { getModel: (id: string) => Promise<{ id: string; identity: { status: string } } | null>; disableModel: (id: string, reason: string) => Promise<unknown>; upsertModel: (entry: unknown) => Promise<unknown> }
): Promise<{ success: boolean; action?: HrAction; error?: string }> {
  const action = await getActionById(id);
  if (!action) return { success: false, error: "Action not found" };
  if (action.approved) return { success: true, action };
  if (action.rejectedBy) return { success: false, error: "Action already rejected" };

  const now = new Date().toISOString();
  const updated = await updateAction(id, (a) => ({
    ...a,
    approved: true,
    approvedBy,
    approvedAtISO: now,
  }));
  if (!updated) return { success: false, error: "Failed to update action" };

  try {
    const model = await registry.getModel(action.modelId);
    if (model) {
      if (action.action === "disable") {
        try {
          emitModelHrSignal({
            modelId: action.modelId,
            previousStatus: model.identity.status,
            newStatus: "disabled",
            reason: action.reason,
          });
        } catch {
          /* never fail */
        }
        await registry.disableModel(action.modelId, action.reason);
      } else if (action.action === "probation") {
        try {
          emitModelHrSignal({
            modelId: action.modelId,
            previousStatus: model.identity.status,
            newStatus: "probation",
            reason: action.reason,
          });
        } catch {
          /* never fail */
        }
        await registry.upsertModel({
          ...model,
          identity: { ...model.identity, status: "probation" as const },
          updatedAtISO: now,
        });
      } else if (action.action === "activate") {
        try {
          emitModelHrSignal({
            modelId: action.modelId,
            previousStatus: model.identity.status,
            newStatus: "active",
            reason: action.reason,
          });
        } catch {
          /* never fail */
        }
        await registry.upsertModel({
          ...model,
          identity: { ...model.identity, status: "active" as const },
          updatedAtISO: now,
        });
      }
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Apply failed", action: updated };
  }
  return { success: true, action: updated };
}

/**
 * Reject an action. Idempotent.
 */
export async function rejectAction(
  id: string,
  rejectedBy: string,
  reason?: string
): Promise<{ success: boolean; action?: HrAction; error?: string }> {
  const action = await getActionById(id);
  if (!action) return { success: false, error: "Action not found" };
  if (action.rejectedBy) return { success: true, action };
  if (action.approved) return { success: false, error: "Action already approved" };

  const now = new Date().toISOString();
  const updated = await updateAction(id, (a) => ({
    ...a,
    rejectedBy,
    rejectedAtISO: now,
    rejectionReason: reason,
  }));
  if (!updated) return { success: false, error: "Failed to update action" };
  return { success: true, action: updated };
}
