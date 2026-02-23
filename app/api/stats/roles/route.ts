// ─── app/api/stats/roles/route.ts ─────────────────────────────────────────────
// Role Analytics: aggregate roleExecutions from demo runs

import { NextRequest, NextResponse } from "next/server";
import { listDemoRunsForRoles } from "../../../lib/demoRunsStore";
import type { RoleExecutionRecord } from "../../../lib/demoRunsStore";

type RoleKey = "ceo" | "manager" | "worker" | "qa" | string;

interface RoleStats {
  executions: number;
  okRate: number;
  failRate: number;
  avgScore?: number;
  p50Score?: number;
  avgCostUSD?: number;
  p50CostUSD?: number;
  topModels?: Array<{ modelId: string; executions: number; avgScore?: number; avgCostUSD?: number }>;
  failureNotesTop?: Array<{ note: string; count: number }>;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const hoursParam = searchParams.get("hours") ?? "168";
    const hours = hoursParam === "0" ? 0 : parseInt(hoursParam, 10) || 168;
    const limit = Math.min(5000, parseInt(searchParams.get("limit") ?? "5000", 10) || 5000);

    const runs = await listDemoRunsForRoles(hours, limit);
    const runsScanned = runs.length;
    const allExecutions: RoleExecutionRecord[] = [];
    for (const r of runs) {
      allExecutions.push(...r.roleExecutions);
    }
    const roleExecutions = allExecutions.length;

    const byRole: Record<RoleKey, RoleStats> = {};
    const roleData = new Map<
      RoleKey,
      {
        ok: number;
        fail: number;
        scores: number[];
        costs: number[];
        models: Map<string, { count: number; scores: number[]; costs: number[] }>;
        failureNotes: Map<string, number>;
      }
    >();

    for (const e of allExecutions) {
      const role = e.role ?? "unknown";
      let data = roleData.get(role);
      if (!data) {
        data = {
          ok: 0,
          fail: 0,
          scores: [],
          costs: [],
          models: new Map(),
          failureNotes: new Map(),
        };
        roleData.set(role, data);
      }

      const isOk = e.status === "ok";
      if (isOk) data.ok++;
      else data.fail++;

      if (typeof e.score === "number") data.scores.push(e.score);
      if (typeof e.costUSD === "number") data.costs.push(e.costUSD);

      const mid = e.modelId ?? "(none)";
      if (mid && mid !== "(none)") {
        let m = data.models.get(mid);
        if (!m) {
          m = { count: 0, scores: [], costs: [] };
          data.models.set(mid, m);
        }
        m.count++;
        if (typeof e.score === "number") m.scores.push(e.score);
        if (typeof e.costUSD === "number") m.costs.push(e.costUSD);
      }

      if (!isOk && e.notes) {
        const bucket = e.notes.slice(0, 120).trim();
        data.failureNotes.set(bucket, (data.failureNotes.get(bucket) ?? 0) + 1);
      }
    }

    const roleOrder: RoleKey[] = ["ceo", "executive", "manager", "worker", "qa"];
    for (const [role, data] of roleData) {
      const total = data.ok + data.fail;
      const scoresSorted = [...data.scores].sort((a, b) => a - b);
      const costsSorted = [...data.costs].sort((a, b) => a - b);

      const topModels = [...data.models.entries()]
        .map(([modelId, m]) => ({
          modelId,
          executions: m.count,
          avgScore: m.scores.length > 0 ? m.scores.reduce((a, b) => a + b, 0) / m.scores.length : undefined,
          avgCostUSD: m.costs.length > 0 ? m.costs.reduce((a, b) => a + b, 0) / m.costs.length : undefined,
        }))
        .sort((a, b) => b.executions - a.executions)
        .slice(0, 5);

      const failureNotesTop = [...data.failureNotes.entries()]
        .map(([note, count]) => ({ note, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      byRole[role] = {
        executions: total,
        okRate: total > 0 ? data.ok / total : 0,
        failRate: total > 0 ? data.fail / total : 0,
        avgScore: data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : undefined,
        p50Score: percentile(scoresSorted, 50),
        avgCostUSD: data.costs.length > 0 ? data.costs.reduce((a, b) => a + b, 0) / data.costs.length : undefined,
        p50CostUSD: percentile(costsSorted, 50),
        topModels: topModels.length > 0 ? topModels : undefined,
        failureNotesTop: failureNotesTop.length > 0 ? failureNotesTop : undefined,
      };
    }

    const orderedByRole: Record<RoleKey, RoleStats> = {};
    for (const r of roleOrder) {
      if (byRole[r]) orderedByRole[r] = byRole[r];
    }
    for (const [k, v] of Object.entries(byRole)) {
      if (!orderedByRole[k]) orderedByRole[k] = v;
    }

    return NextResponse.json(
      {
        totals: { runsScanned, roleExecutions },
        byRole: orderedByRole,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("API /api/stats/roles error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    );
  }
}
