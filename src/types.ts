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
