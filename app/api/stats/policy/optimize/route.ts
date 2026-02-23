import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { aggregatePolicyStats } from "../../../../../src/policyStats";
import { optimizePolicy } from "../../../../../src/policyOptimizer/optimizePolicy";
import type { RunLogEvent } from "../../../../../src/runLog";
import type { EscalationConfig } from "../../../../../src/types";
import type { PolicyStatsInput } from "../../../../../src/policyOptimizer/types";

const DEFAULT_RUNS_PATH = "./runs/runs.jsonl";

const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  policy: "promote_on_low_score",
  maxPromotions: 1,
  promotionMargin: 0.02,
  scoreResolution: 0.01,
  minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
  requireEvalForDecision: true,
  escalateJudgeAlways: true,
  routingMode: "escalation_aware",
  cheapFirstMaxGapByDifficulty: { low: 0.06, medium: 0.08, high: 0.1 },
  cheapFirstMinConfidence: 0.4,
  cheapFirstSavingsMinPct: 0.3,
  cheapFirstBudgetHeadroomFactor: 1.1,
  cheapFirstOnlyWhenCanPromote: true,
};

function toOptimizerInput(stats: ReturnType<typeof aggregatePolicyStats>): PolicyStatsInput {
  return {
    totals: {
      runs: stats.totals.runs,
      cheapFirstRate: stats.totals.cheapFirstRate,
      escalationRate: stats.totals.escalationRate,
      avgEstimatedSavingsPct: stats.totals.avgEstimatedSavingsPct,
      avgRealizedTotalCostUSD: stats.totals.avgRealizedTotalCostUSD,
      avgFinalScore: stats.totals.avgFinalScore,
    },
    byTaskType: stats.byTaskType,
    byDifficulty: stats.byDifficulty,
    regret: { count: stats.regret.count },
    economicRegret: { count: stats.economicRegret.count },
    primaryBlockerCounts: stats.primaryBlockerCounts,
  };
}

export async function GET() {
  try {
    const logPath = join(process.cwd(), DEFAULT_RUNS_PATH);
    let raw: string;
    try {
      raw = await readFile(logPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const emptyStats = aggregatePolicyStats([]);
        const input = toOptimizerInput(emptyStats);
        const optimizer = optimizePolicy(input, DEFAULT_ESCALATION_CONFIG);
        return NextResponse.json(
          { stats: emptyStats, optimizer },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      throw err;
    }

    const lines = raw.trim().split("\n").filter(Boolean);
    const events: RunLogEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RunLogEvent;
        events.push(parsed);
      } catch {
        // skip malformed lines
      }
    }

    const stats = aggregatePolicyStats(events);
    const input = toOptimizerInput(stats);
    const optimizer = optimizePolicy(input, DEFAULT_ESCALATION_CONFIG);

    return NextResponse.json(
      { stats, optimizer },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("API /api/stats/policy/optimize error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
