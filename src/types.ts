/**
 * Task Router Types
 * Defines interfaces for tasks, model specs, and routing decisions.
 */

/** Supported task types (extensible) */
export type TaskType = "code" | "writing" | "analysis" | "general";

/** Task difficulty levels */
export type Difficulty = "low" | "medium" | "high";

/** Expertise thresholds by difficulty (minimum required) */
export const DIFFICULTY_THRESHOLDS: Record<Difficulty, number> = {
  low: 0.7,
  medium: 0.8,
  high: 0.88,
} as const;

/** Behavior when no models qualify (e.g. budget too low) */
export type OnBudgetFail = "fail" | "best_effort_within_budget" | "ignore_budget";

/** Model selection policy when multiple models qualify */
export type SelectionPolicy = "lowest_cost_qualified" | "best_value";

/** Behavior when no models qualify (for best_value policy) */
export type NoQualifiedPolicy = "highest_expertise" | "best_value_near_threshold";

/** Router configuration (optional; sensible defaults used when omitted) */
export interface RouterConfig {
  thresholds: Record<Difficulty, number>;
  baseTokenEstimates: {
    input: Partial<Record<TaskType, number>>;
    output: Partial<Record<TaskType, number>>;
  };
  difficultyMultipliers: Record<Difficulty, number>;
  fallbackCount: number;
  onBudgetFail: OnBudgetFail;
  /** Evaluation sample rate 0..1; default 0.25. Only final successful attempts are sampled. */
  evaluationSampleRate?: number;
  /** Model selection policy; default lowest_cost_qualified */
  selectionPolicy?: SelectionPolicy;
  /** When no models qualify and selectionPolicy is best_value; default highest_expertise */
  noQualifiedPolicy?: NoQualifiedPolicy;
  /** Delta below threshold for near-threshold models; default { low: 0.04, medium: 0.06, high: 0.10 } */
  nearThresholdDeltaByDifficulty?: Record<Difficulty, number>;
  /** Min calibration confidence to trust; below this use confidenceFloor. Default 0.2 */
  minConfidenceToUseCalibration?: number;
  /** Floor applied when raw confidence < minConfidenceToUseCalibration. Default 0.1 */
  confidenceFloor?: number;
  /** Min benefit (Q - threshold) by difficulty for qualified best_value. Default { low: 0, medium: 0.02, high: 0.04 } */
  minBenefitByDifficulty?: Record<Difficulty, number>;
  /** Min benefit near threshold (Q - (threshold - delta)) by difficulty. Default { low: 0, medium: 0.01, high: 0.02 } */
  minBenefitNearThresholdByDifficulty?: Record<Difficulty, number>;
  /** Escalation config for promote-on-low-score (Stage 5) */
  escalation?: EscalationConfig;
  /** Premium lanes: task types that skip cheap-first even when escalation_aware. Default []. */
  premiumTaskTypes?: TaskType[];
}

/** Escalation policy: off or promote when eval score below threshold */
export type EscalationPolicy = "off" | "promote_on_low_score";

/** Escalation routing mode: normal (unchanged) or cheap-first when escalation can fix misses */
export type EscalationRoutingMode = "normal" | "escalation_aware";

/** Escalation configuration for Stage 5 single-hop promotion */
export interface EscalationConfig {
  policy: EscalationPolicy;
  maxPromotions: number;
  /** Promote only if score is below threshold by at least this margin. Default 0.02 */
  promotionMargin?: number;
  /** Round scores to this resolution before comparing (e.g. 0.01 = 2 decimals). Default 0.01. */
  scoreResolution?: number;
  minScoreByDifficulty: Record<Difficulty, number>;
  minScoreByTaskType?: Partial<Record<TaskType, Record<Difficulty, number>>>;
  allowWhenNoQualified?: boolean;
  requireEvalForDecision?: boolean;
  escalateJudgeAlways?: boolean;
  escalationModelOrderByTaskType?: Partial<Record<TaskType, string[]>>;
  maxExtraCostUSD?: number;
  /** Stage 5.2: routing mode; default "normal". When "escalation_aware", may pick cheaper attempt 1. */
  routingMode?: EscalationRoutingMode;
  /** Max (threshold - Q) for cheap-first when candidate does NOT qualify; must be within near band. Default {low:0.06, medium:0.08, high:0.10} */
  cheapFirstMaxGapByDifficulty?: Record<Difficulty, number>;
  /** Per-taskType override for max gap (takes precedence over cheapFirstMaxGapByDifficulty). E.g. { writing: { high: 0.12 } } */
  cheapFirstMaxGapByTaskType?: Partial<Record<TaskType, Partial<Record<Difficulty, number>>>>;
  /** Min raw calibration confidence for cheap-first. Default 0.4 */
  cheapFirstMinConfidence?: number;
  /** Min savings ratio vs normal pick (0–1). require candidateCost <= normalCost * (1 - pct). Default 0.30 */
  cheapFirstSavingsMinPct?: number;
  /** Per-taskType overrides for confidence and savings gates. E.g. { writing: { minConfidence: 0.25, savingsMinPct: 0.20 } } */
  cheapFirstOverridesByTaskType?: Partial<Record<TaskType, { minConfidence?: number; savingsMinPct?: number }>>;
  /** Optional secondary: min absolute savings (USD) to justify cheap-first */
  cheapFirstSavingsMinUSD?: number;
  /** Require this factor of headroom on worst-case cost vs budget. Default 1.1 */
  cheapFirstBudgetHeadroomFactor?: number;
  /** Never choose cheap-first if no valid promotion target exists. Default true */
  cheapFirstOnlyWhenCanPromote?: boolean;
  /** Stage 6.3: Only include gateProgress in audit when cheap-first fails. Default true. Reduces JSONL size. */
  logPrimaryBlockerOnlyWhenFailed?: boolean;
  /** Stage 6.3: "focused" = eval cheap-first runs at cheapFirstEvalRate, others at normalEvalRate. Default "uniform". */
  evaluationMode?: "uniform" | "focused";
  /** Stage 6.3: When evaluationMode=focused, eval rate for cheap-first runs. Default 1.0 */
  cheapFirstEvalRate?: number;
  /** Stage 6.3: When evaluationMode=focused, eval rate for normal runs. Default 0.25 */
  normalEvalRate?: number;
}

/** Task definition passed to the router */
export interface TaskCard {
  id: string;
  taskType: TaskType;
  difficulty: Difficulty;
  constraints?: {
    minQuality?: number;
    maxCostUSD?: number;
  };
}

/** Pricing per 1k tokens (input/output) */
export interface Pricing {
  inPer1k: number;
  outPer1k: number;
}

/** Model specification with expertise per task type */
export interface ModelSpec {
  id: string;
  displayName: string;
  /** Expertise score 0-1 per task type */
  expertise: Record<TaskType, number>;
  pricing: Pricing;
  /** Reliability score 0-1 */
  reliability: number;
}

/** Routing decision status */
export type RoutingStatus = "ok" | "no_qualified_models";

/** Optional metadata when portfolio routing is used */
export interface RoutingMeta {
  portfolioBypassed?: boolean;
  reason?: string;
}

/** Result of the routing decision */
export interface RoutingDecision {
  chosenModelId: string | null;
  fallbackModelIds: string[];
  expectedCostUSD: number | null;
  estimatedTokens: { input: number; output: number };
  status: RoutingStatus;
  rationale: string;
  routingMeta?: RoutingMeta;
}
