/**
 * Model HR signal log. File-backed or DB-backed when PERSISTENCE_DRIVER=db.
 * Emits MODEL_HR_SIGNAL when: probation, auto-disable, kill-switch.
 * Never throws - logging failures are swallowed to avoid run failures.
 */

import { appendFile, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getSignalsRetentionDays } from "../config.js";
import { getPersistenceDriver } from "../../persistence/driver.js";
import {
  emitModelHrSignalDb,
  readModelHrSignalsDb,
  readModelHrSignalsForModelDb,
} from "./signalLogDb.js";

export interface ModelHrSignal {
  modelId: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  sampleCount?: number;
  tsISO: string;
  /** Optional context (e.g. packageId, runSessionId for escalation signals) */
  context?: Record<string, unknown>;
}

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

function getSignalsPath(): string {
  return join(getDataDir(), "signals.jsonl");
}

async function ensureDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

function getRetentionCutoffISO(): string {
  const days = getSignalsRetentionDays();
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Append a signal to the log. Never throws.
 */
export function emitModelHrSignal(signal: Omit<ModelHrSignal, "tsISO">): void {
  const full: ModelHrSignal = { ...signal, tsISO: new Date().toISOString() };
  if (getPersistenceDriver() === "db") {
    void emitModelHrSignalDb(full);
    return;
  }
  const line = JSON.stringify(full) + "\n";
  ensureDir()
    .then(() => appendFile(getSignalsPath(), line, "utf-8"))
    .catch(() => {
      /* swallow - no run failure */
    });
}

/**
 * Emit an escalation signal for observability. Never throws.
 * Used when ESCALATION decisions occur during runs; does not change model status.
 */
export function emitEscalationSignal(
  modelId: string,
  reason: string,
  context?: Record<string, unknown>
): void {
  try {
    emitModelHrSignal({
      modelId,
      previousStatus: "n/a",
      newStatus: "n/a",
      reason,
      ...(context && Object.keys(context).length > 0 && { context }),
    });
  } catch {
    /* swallow - no run failure */
  }
}

/**
 * Read recent signals from the log. Returns [] on error.
 * Trims file to retention window when reading (prevents unbounded growth).
 */
export async function readModelHrSignals(limit: number = 100): Promise<ModelHrSignal[]> {
  if (getPersistenceDriver() === "db") {
    return readModelHrSignalsDb(limit);
  }
  try {
    const path = getSignalsPath();
    const raw = await readFile(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const cutoff = getRetentionCutoffISO();
    const parsed: ModelHrSignal[] = [];
    const retainedLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]) as ModelHrSignal;
        if (obj.modelId && obj.reason && obj.tsISO) {
          if (obj.tsISO >= cutoff) {
            parsed.push(obj);
            retainedLines.push(lines[i]);
          }
        }
      } catch {
        /* skip malformed lines */
      }
    }
    if (retainedLines.length < lines.length) {
      try {
        await writeFile(path, retainedLines.map((l) => l + "\n").join(""), "utf-8");
      } catch {
        /* warn only - do not fail */
        console.warn("[ModelHR] Failed to trim signals.jsonl");
      }
    }
    parsed.sort((a, b) => (a.tsISO ?? "").localeCompare(b.tsISO ?? ""));
    return parsed.slice(-limit).reverse();
  } catch {
    return [];
  }
}

/**
 * Read recent signals for a specific model. Returns [] on error or if file missing.
 */
export async function readModelHrSignalsForModel(
  modelId: string,
  limit: number = 50
): Promise<ModelHrSignal[]> {
  if (getPersistenceDriver() === "db") {
    return readModelHrSignalsForModelDb(modelId, limit);
  }
  try {
    const all = await readModelHrSignals(2000);
    const filtered = all.filter((s) => s.modelId === modelId).slice(0, limit);
    return filtered;
  } catch {
    return [];
  }
}
