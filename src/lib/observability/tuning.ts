/**
 * Deterministic tuning proposals from KPIs and config.
 * No LLM calls. Safe by default.
 */

// ─── src/lib/observability/tuning.ts ─────────────────────────────────────────

import { createHash } from "crypto";
import type { AggregatedKpis } from "./analytics.js";
import type { RunSummary } from "./analytics.js";

export interface TuningProposal {
  id: string;
  action: string;
  details: Record<string, unknown>;
  rationale: string;
  safeToAutoApply: boolean;
}

export interface CurrentConfig {
  portfolioMode: string;
  minPredictedQuality?: number;
}

function stableId(action: string, details: Record<string, unknown>): string {
  const str = `${action}:${JSON.stringify(details)}`;
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function aggregateBypassReasons(summaries: RunSummary[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of summaries) {
    for (const [reason, count] of s.routing.topBypassReasons) {
      out[reason] = (out[reason] ?? 0) + count;
    }
  }
  return out;
}

function getDominantBypassReason(summaries: RunSummary[]): string | null {
  const breakdown = aggregateBypassReasons(summaries);
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return null;
  return entries[0][1] / total >= 0.5 ? entries[0][0] : null;
}

function getQaTrustLowShare(summaries: RunSummary[]): number {
  let sum = 0;
  let count = 0;
  for (const s of summaries) {
    if (s.variance.skipped > 0 && s.variance.qaTrustLowCount != null) {
      sum += s.variance.qaTrustLowCount / s.variance.skipped;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function getAvgDeterministicPassRate(summaries: RunSummary[]): number | null {
  const withRate = summaries.filter((s) => s.quality.deterministicPassRate != null);
  if (withRate.length === 0) return null;
  const sum = withRate.reduce((s, r) => s + (r.quality.deterministicPassRate ?? 0), 0);
  return sum / withRate.length;
}

export function proposeTuning(
  kpis: AggregatedKpis,
  summaries: RunSummary[],
  currentConfig: CurrentConfig
): TuningProposal[] {
  const proposals: TuningProposal[] = [];

  if (
    currentConfig.portfolioMode === "lock" &&
    kpis.averages.bypassRate >= 0.3 &&
    summaries.length > 0
  ) {
    const dominant = getDominantBypassReason(summaries);
    if (dominant === "allowed_models_over_budget") {
      const details = { mode: "prefer" as const };
      proposals.push({
        id: stableId("set_portfolio_mode", details),
        action: "set_portfolio_mode",
        details,
        rationale:
          "Lock mode with high bypass rate dominated by allowed_models_over_budget; relaxing to prefer reduces blocking.",
        safeToAutoApply: true,
      });
    }
  }

  const qaTrustLowShare = getQaTrustLowShare(summaries);
  if (qaTrustLowShare >= 0.2) {
    const details = { forceRefresh: true };
    proposals.push({
      id: stableId("refresh_portfolio", details),
      action: "refresh_portfolio",
      details,
      rationale:
        "High variance skipped due to qa_trust_low; refreshing portfolio may improve QA slot selection.",
      safeToAutoApply: true,
    });
  }

  const avgDetPass = getAvgDeterministicPassRate(summaries);
  if (summaries.length > 0 && avgDetPass != null && avgDetPass >= 0.7) {
    const dominant = getDominantBypassReason(summaries);
    if (dominant === "allowed_models_below_quality") {
      const delta = 0.02;
      const current = currentConfig.minPredictedQuality ?? 0.72;
      const details = { delta, newValue: Math.max(0.5, current - delta) };
      proposals.push({
        id: stableId("lower_minPredictedQuality", details),
        action: "lower_minPredictedQuality",
        details,
        rationale:
          "Bypass dominated by below-quality with high deterministic pass rate; lowering minPredictedQuality may reduce bypass.",
        safeToAutoApply: false,
      });
    }
  }

  return proposals;
}
