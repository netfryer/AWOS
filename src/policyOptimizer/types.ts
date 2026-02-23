/**
 * Stage 6: Policy Optimizer types.
 * Advisory-only tuning recommendations from policy stats.
 */

export interface PolicyStatsInput {
  totals: {
    runs: number;
    cheapFirstRate: number;
    escalationRate: number;
    avgEstimatedSavingsPct: number;
    avgRealizedTotalCostUSD: number;
    avgFinalScore: number;
  };
  byTaskType: Record<
    string,
    {
      runs: number;
      cheapFirstRate: number;
      escalationRate: number;
      avgSavingsUSD: number;
      avgRealizedCostUSD: number;
      avgFinalScore: number;
    }
  >;
  byDifficulty: Record<
    string,
    {
      runs: number;
      cheapFirstRate: number;
      escalationRate: number;
      avgSavingsUSD: number;
      avgRealizedCostUSD: number;
      avgFinalScore: number;
    }
  >;
  regret: { count: number };
  economicRegret: { count: number };
  /** Stage 6.3: Primary blocker counts — used to target the right parameter (not gap when blocker is savings/confidence) */
  primaryBlockerCounts?: {
    totals: Record<string, number>;
    byTaskType: Record<string, Record<string, number>>;
    byDifficulty: Record<string, Record<string, number>>;
  };
}

export type RecommendationParameter =
  | "cheapFirstMaxGapByDifficulty"
  | "cheapFirstMinConfidence"
  | "cheapFirstSavingsMinPct"
  | "promotionMargin";

export type RecommendationConfidence = "low" | "medium" | "high";

export interface PolicyRecommendation {
  severity: "info" | "adjust" | "warning";
  scope: "global" | "taskType" | "difficulty";
  target?: string;
  parameter: RecommendationParameter;
  currentValue?: number;
  suggestedValue: number;
  rationale: string;
  expectedImpact: string;
  /** Stage 6.2: runs supporting this recommendation */
  evidenceRuns: number;
  /** Stage 6.2: low | medium | high — prevents over-tuning off small samples */
  confidence: RecommendationConfidence;
}

export type PolicyHealth = "healthy" | "conservative" | "aggressive" | "unstable";

export interface PolicyOptimizerResult {
  summary: string;
  health: PolicyHealth;
  recommendations: PolicyRecommendation[];
}
