/**
 * Registry health: records fallback usage and provides fallback count for Ops UI.
 * Retention: trims entries older than MODEL_HR_FALLBACK_RETENTION_DAYS on read.
 */

import { appendFile, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getFallbackRetentionDays } from "./config.js";

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

function getFallbackLogPath(): string {
  return join(getDataDir(), "registry-fallback.jsonl");
}

/**
 * Record that registry fallback was used. Never throws.
 */
export function recordRegistryFallback(errorSummary?: string): void {
  const entry = {
    tsISO: new Date().toISOString(),
    errorSummary: errorSummary ?? null,
  };
  const line = JSON.stringify(entry) + "\n";
  mkdir(getDataDir(), { recursive: true })
    .then(() => appendFile(getFallbackLogPath(), line, "utf-8"))
    .catch(() => {
      /* swallow - no run failure */
    });
}

/**
 * Count fallback events in the last N hours. Returns 0 on error.
 * Trims file to retention window when reading (prevents unbounded growth).
 */
export async function getRegistryFallbackCountLastHours(hours: number = 24): Promise<number> {
  try {
    const path = getFallbackLogPath();
    const raw = await readFile(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const retentionCutoff = new Date(Date.now() - getFallbackRetentionDays() * 24 * 60 * 60 * 1000).toISOString();
    const countCutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const retainedLines: string[] = [];
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]) as { tsISO?: string };
        if (obj?.tsISO) {
          if (obj.tsISO >= retentionCutoff) {
            retainedLines.push(lines[i]);
            if (obj.tsISO >= countCutoff) count++;
          }
        }
      } catch {
        /* skip malformed */
      }
    }
    if (retainedLines.length < lines.length) {
      try {
        await writeFile(path, retainedLines.map((l) => l + "\n").join(""), "utf-8");
      } catch {
        console.warn("[ModelHR] Failed to trim registry-fallback.jsonl");
      }
    }
    return count;
  } catch {
    return 0;
  }
}
