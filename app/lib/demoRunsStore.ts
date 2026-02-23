// ─── app/lib/demoRunsStore.ts ─────────────────────────────────────────────────
// File-backed store for demo run responses: .data/demo-runs/<id>.json

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";

/** Stored deliverable output keyed by package id (e.g. aggregation-report). */
export interface DeliverableEntry {
  output?: string;
  artifactId?: string;
  artifactHash?: string;
}

export interface DemoRunPayload {
  runSessionId: string;
  timestamp: string;
  plan?: unknown;
  packages?: unknown[];
  result?: {
    runs?: Array<{ packageId: string; modelId: string; actualCostUSD: number; isEstimatedCost?: boolean; artifactId?: string; output?: string }>;
    qaResults?: Array<{ packageId: string; workerPackageId: string; pass: boolean; qualityScore: number; modelId?: string }>;
    escalations?: unknown[];
    budget?: { startingUSD: number; remainingUSD: number };
    warnings?: string[];
    roleExecutions?: RoleExecutionRecord[];
  };
  /** Persisted deliverable content (aggregation-report output, etc.). */
  deliverables?: Record<string, DeliverableEntry>;
  bundle?: {
    ledger?: {
      costs?: Record<string, number>;
      decisions?: Array<{ type: string; packageId?: string; details?: Record<string, unknown> }>;
      roleExecutions?: RoleExecutionRecord[];
    };
    summary?: unknown;
  };
}

export interface RoleExecutionRecord {
  role: string;
  nodeId: string;
  status?: "ok" | "fail" | "retry";
  modelId?: string;
  score?: number;
  costUSD?: number;
  notes?: string;
}

function getStoreDir(): string {
  return path.join(process.cwd(), ".data", "demo-runs");
}

function getFilePath(id: string): string {
  return path.join(getStoreDir(), `${id}.json`);
}

/** Extracts deliverables from runs (aggregation-report output, etc.). Never throws. */
export function extractDeliverablesFromRuns(
  runs?: Array<{ packageId?: string; output?: string; artifactId?: string; artifactHash?: string }>
): Record<string, DeliverableEntry> {
  const out: Record<string, DeliverableEntry> = {};
  if (!Array.isArray(runs)) return out;
  try {
    for (const r of runs) {
      const id = r?.packageId;
      if (!id || typeof id !== "string") continue;
      const output = typeof r?.output === "string" ? r.output : undefined;
      if (!output && !r?.artifactId) continue;
      out[id] = {
        output: output || undefined,
        artifactId: r?.artifactId,
        artifactHash: r?.artifactHash,
      };
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Persists demo run. Never throws; logs and continues on I/O failure. */
export async function saveDemoRun(id: string, payload: DemoRunPayload): Promise<void> {
  try {
    const dir = getStoreDir();
    await mkdir(dir, { recursive: true });
    const filePath = getFilePath(id);
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch (e) {
    console.warn("[demoRunsStore] saveDemoRun failed:", e instanceof Error ? e.message : e);
  }
}

export async function loadDemoRun(id: string): Promise<DemoRunPayload | null> {
  try {
    const filePath = getFilePath(id);
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as DemoRunPayload;
    if (parsed?.runSessionId) return parsed;
    return null;
  } catch {
    return null;
  }
}

export interface DemoRunListItem {
  id: string;
  ts: string;
  cost?: number;
  qaPass?: boolean;
}

/** List recent demo runs, never throws. */
export async function listDemoRuns(limit = 20): Promise<DemoRunListItem[]> {
  try {
    const dir = getStoreDir();
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    const items: DemoRunListItem[] = [];
    for (const f of files) {
      try {
        const id = f.slice(0, -5);
        const raw = await readFile(path.join(dir, f), "utf-8");
        const parsed = JSON.parse(raw) as DemoRunPayload;
        if (!parsed?.runSessionId) continue;
        const budget = parsed.result?.budget;
        const cost =
          budget != null
            ? budget.startingUSD - (budget.remainingUSD ?? 0)
            : parsed.bundle?.ledger?.costs
              ? (parsed.bundle.ledger.costs.councilUSD ?? 0) +
                (parsed.bundle.ledger.costs.workerUSD ?? 0) +
                (parsed.bundle.ledger.costs.qaUSD ?? 0) +
                (parsed.bundle.ledger.costs.deterministicQaUSD ?? 0)
              : undefined;
        const qaResults = parsed.result?.qaResults ?? [];
        const qaPass = qaResults.length > 0 ? qaResults.every((q) => q.pass) : undefined;
        items.push({
          id: parsed.runSessionId,
          ts: parsed.timestamp ?? "",
          cost,
          qaPass,
        });
      } catch {
        /* skip invalid file */
      }
    }
    items.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    return items.slice(0, limit);
  } catch {
    return [];
  }
}

export interface DemoRunWithRoleExecutions {
  runSessionId: string;
  timestamp: string;
  roleExecutions: RoleExecutionRecord[];
}

/** List demo runs with roleExecutions for role analytics. Filter by hours (0=all), limit scans. */
export async function listDemoRunsForRoles(
  hours: number,
  limit: number
): Promise<DemoRunWithRoleExecutions[]> {
  try {
    const dir = getStoreDir();
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    const cutoff =
      hours > 0 ? Date.now() - hours * 60 * 60 * 1000 : 0;
    const items: DemoRunWithRoleExecutions[] = [];
    const withTs: Array<{ ts: string; f: string }> = [];
    for (const f of files) {
      try {
        const raw = await readFile(path.join(dir, f), "utf-8");
        const parsed = JSON.parse(raw) as DemoRunPayload;
        const ts = parsed?.timestamp ?? "";
        if (!parsed?.runSessionId || !ts) continue;
        const tsMs = new Date(ts).getTime();
        if (cutoff > 0 && tsMs < cutoff) continue;
        withTs.push({ ts, f });
      } catch {
        /* skip */
      }
    }
    withTs.sort((a, b) => b.ts.localeCompare(a.ts));
    const toLoad = withTs.slice(0, limit);
    for (const { f } of toLoad) {
      try {
        const id = f.slice(0, -5);
        const raw = await readFile(path.join(dir, f), "utf-8");
        const parsed = JSON.parse(raw) as DemoRunPayload;
        const roleExecutions: RoleExecutionRecord[] =
          (parsed.result as { roleExecutions?: RoleExecutionRecord[] } | undefined)?.roleExecutions ??
          (parsed.bundle?.ledger as { roleExecutions?: RoleExecutionRecord[] } | undefined)?.roleExecutions ??
          [];
        items.push({
          runSessionId: parsed.runSessionId,
          timestamp: parsed.timestamp ?? "",
          roleExecutions,
        });
      } catch {
        /* skip */
      }
    }
    return items;
  } catch {
    return [];
  }
}
