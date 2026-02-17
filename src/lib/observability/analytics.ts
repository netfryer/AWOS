/**
 * Deterministic analytics and KPIs over ledger summaries.
 * No LLM calls. Compact, UI-friendly outputs.
 */

// ─── src/lib/observability/analytics.ts ───────────────────────────────────────

import type { Ledger } from "./runLedger.js";

export interface RunSummary {
  runSessionId: string;
  startedAtISO: string;
  finishedAtISO?: string;
  costs: {
    councilUSD: number;
    workerUSD: number;
    qaUSD: number;
    deterministicQaUSD: number;
    totalUSD: number;
  };
  counts: {
    packagesTotal: number;
    worker: number;
    qa: number;
    completed?: number;
  };
  variance: {
    recorded: number;
    skipped: number;
    topSkipReasons: [string, number][];
    qaTrustLowCount?: number;
  };
  routing: {
    portfolioMode?: string;
    bypassRate: number;
    topBypassReasons: [string, number][];
  };
  governance: {
    escalations: number;
    councilPlanningSkipped: boolean;
  };
  quality: {
    deterministicPassRate?: number;
    avgQaQualityScore?: number;
  };
}

const TOP_N = 5;

function topEntries(record: Record<string, number>, n: number): [string, number][] {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function summarizeLedger(ledger: Ledger): RunSummary {
  const routeDecisions = ledger.decisions.filter((d) => d.type === "ROUTE");
  const routeWithPortfolio = routeDecisions.filter(
    (d) => d.details?.portfolioMode && d.details.portfolioMode !== "off"
  );
  const bypassed = routeDecisions.filter((d) => d.details?.portfolioBypassed === true);
  const bypassReasons: Record<string, number> = {};
  for (const d of bypassed) {
    const r = String(d.details?.bypassReason ?? "unknown");
    bypassReasons[r] = (bypassReasons[r] ?? 0) + 1;
  }
  const portfolioMode = routeWithPortfolio[0]?.details?.portfolioMode as string | undefined;

  const escalationDecisions = ledger.decisions.filter((d) => d.type === "ESCALATION");
  const councilSkipped = ledger.decisions.some(
    (d) =>
      d.type === "BUDGET_OPTIMIZATION" &&
      d.details?.councilPlanningSkipped === true
  );

  const totalUSD =
    ledger.costs.councilUSD +
    ledger.costs.workerUSD +
    ledger.costs.qaUSD +
    ledger.costs.deterministicQaUSD;

  return {
    runSessionId: ledger.runSessionId,
    startedAtISO: ledger.startedAtISO,
    finishedAtISO: ledger.finishedAtISO,
    costs: {
      councilUSD: ledger.costs.councilUSD,
      workerUSD: ledger.costs.workerUSD,
      qaUSD: ledger.costs.qaUSD,
      deterministicQaUSD: ledger.costs.deterministicQaUSD,
      totalUSD,
    },
    counts: {
      packagesTotal: ledger.counts.packagesTotal,
      worker: ledger.counts.worker,
      qa: ledger.counts.qa,
      completed: ledger.counts.completed,
    },
    variance: {
      recorded: ledger.variance.recorded,
      skipped: ledger.variance.skipped,
      topSkipReasons: topEntries(ledger.variance.skipReasons, TOP_N),
      qaTrustLowCount: ledger.variance.skipReasons["qa_trust_low"],
    },
    routing: {
      portfolioMode,
      bypassRate:
        routeWithPortfolio.length > 0
          ? bypassed.length / routeWithPortfolio.length
          : 0,
      topBypassReasons: topEntries(bypassReasons, TOP_N),
    },
    governance: {
      escalations: escalationDecisions.length,
      councilPlanningSkipped: councilSkipped,
    },
    quality: {},
  };
}

export interface AggregatedKpis {
  window: number;
  totals: {
    councilUSD: number;
    workerUSD: number;
    qaUSD: number;
    deterministicQaUSD: number;
    totalUSD: number;
    packagesTotal: number;
    completed: number;
    escalations: number;
    varianceRecorded: number;
    varianceSkipped: number;
  };
  averages: {
    totalUSDPerRun: number;
    bypassRate: number;
    councilPlanningSkippedRate: number;
  };
  trends?: {
    recentTotalUSD?: number;
    olderTotalUSD?: number;
  };
  recommendations: string[];
}

const BYPASS_RATE_THRESHOLD = 0.3;
const QA_SHARE_THRESHOLD = 0.4;
const DETERMINISTIC_PASS_THRESHOLD = 0.7;
const QA_TRUST_LOW_THRESHOLD = 0.2;

export function aggregateKpis(summaries: RunSummary[]): AggregatedKpis {
  const window = summaries.length;
  const totals = {
    councilUSD: 0,
    workerUSD: 0,
    qaUSD: 0,
    deterministicQaUSD: 0,
    totalUSD: 0,
    packagesTotal: 0,
    completed: 0,
    escalations: 0,
    varianceRecorded: 0,
    varianceSkipped: 0,
  };

  let bypassSum = 0;
  let bypassCount = 0;
  let councilSkippedCount = 0;
  const bypassReasonCounts: Record<string, number> = {};
  let qaShareSum = 0;
  let qaShareCount = 0;
  let deterministicPassSum = 0;
  let deterministicPassCount = 0;
  let qaTrustLowShareSum = 0;
  let qaTrustLowCount = 0;

  for (const s of summaries) {
    totals.councilUSD += s.costs.councilUSD;
    totals.workerUSD += s.costs.workerUSD;
    totals.qaUSD += s.costs.qaUSD;
    totals.deterministicQaUSD += s.costs.deterministicQaUSD;
    totals.totalUSD += s.costs.totalUSD;
    totals.packagesTotal += s.counts.packagesTotal;
    totals.completed += (s.counts.completed ?? 0);
    totals.escalations += s.governance.escalations;
    totals.varianceRecorded += s.variance.recorded;
    totals.varianceSkipped += s.variance.skipped;

    if (s.routing.portfolioMode) {
      bypassSum += s.routing.bypassRate;
      bypassCount += 1;
      for (const [reason, count] of s.routing.topBypassReasons) {
        bypassReasonCounts[reason] = (bypassReasonCounts[reason] ?? 0) + count;
      }
    }
    if (s.governance.councilPlanningSkipped) councilSkippedCount += 1;

    if (s.costs.totalUSD > 0) {
      const qaShare = s.costs.qaUSD / s.costs.totalUSD;
      qaShareSum += qaShare;
      qaShareCount += 1;
    }
    if (s.quality.deterministicPassRate != null) {
      deterministicPassSum += s.quality.deterministicPassRate;
      deterministicPassCount += 1;
    }
    if (s.variance.skipped > 0 && s.variance.qaTrustLowCount != null) {
      qaTrustLowShareSum += s.variance.qaTrustLowCount / s.variance.skipped;
      qaTrustLowCount += 1;
    }
  }

  const recommendations: string[] = [];

  if (bypassCount > 0) {
    const avgBypass = bypassSum / bypassCount;
    if (avgBypass >= BYPASS_RATE_THRESHOLD) {
      const overBudget = bypassReasonCounts["allowed_models_over_budget"] ?? 0;
      const totalBypass = Object.values(bypassReasonCounts).reduce((a, b) => a + b, 0);
      if (totalBypass > 0 && overBudget / totalBypass >= 0.5) {
        recommendations.push(
          "High bypass rate with allowed_models_over_budget: consider raising budgets or relaxing portfolio lock mode."
        );
      }
    }
  }

  if (qaShareCount > 0) {
    const avgQaShare = qaShareSum / qaShareCount;
    if (avgQaShare >= QA_SHARE_THRESHOLD && deterministicPassCount > 0) {
      const avgDetPass = deterministicPassSum / deterministicPassCount;
      if (avgDetPass >= DETERMINISTIC_PASS_THRESHOLD) {
        recommendations.push(
          "High QA cost share (>40%) with high deterministic pass rate: consider reducing LLM QA frequency."
        );
      }
    }
  }

  if (qaTrustLowCount > 0) {
    const avgQaTrustLowShare = qaTrustLowShareSum / qaTrustLowCount;
    if (avgQaTrustLowShare >= QA_TRUST_LOW_THRESHOLD) {
      recommendations.push(
        "High variance skipped due to qa_trust_low: consider raising QA trust floor or changing portfolio QA slot."
      );
    }
  }

  let trends: AggregatedKpis["trends"];
  if (summaries.length >= 10) {
    const half = Math.floor(summaries.length / 2);
    const recent = summaries.slice(0, half);
    const older = summaries.slice(half);
    trends = {
      recentTotalUSD: recent.reduce((s, r) => s + r.costs.totalUSD, 0),
      olderTotalUSD: older.reduce((s, r) => s + r.costs.totalUSD, 0),
    };
  }

  return {
    window,
    totals,
    averages: {
      totalUSDPerRun: window > 0 ? totals.totalUSD / window : 0,
      bypassRate: bypassCount > 0 ? bypassSum / bypassCount : 0,
      councilPlanningSkippedRate: window > 0 ? councilSkippedCount / window : 0,
    },
    trends,
    recommendations,
  };
}
