/**
 * Run log event schema for JSONL logging.
 */

import type { TaskType, Difficulty, RoutingDecision } from "./types.js";
import type { ExecutionResult } from "./executor/types.js";
import type { ValidationResult } from "./validator.js";
import type { EvalResult } from "./evaluator/types.js";

/** Escalation metadata when attempt is an escalation promotion */
export interface RunAttemptEscalation {
  promotedFromModelId: string;
  promotedToModelId: string;
  reason: string;
  threshold: number;
  initialScore: number;
  chosenScore: number;
  chosenAttempt: "initial" | "escalated";
  incrementalExpectedCostUSD?: number;
  incrementalActualCostUSD?: number;
}

export interface RunAttempt {
  attempt: number;
  modelId: string;
  prompt: string;
  execution: ExecutionResult;
  validation: ValidationResult;
  /** Actual cost in USD when execution.usage is available */
  actualCostUSD?: number;
  /** LLM-as-judge quality score 0-1 when evaluated (legacy) */
  qualityScore?: number;
  /** Evaluator result when sampled on final attempt */
  eval?: {
    status: "ok" | "skipped" | "error";
    result?: EvalResult;
    error?: string;
    judgeModelId?: string;
    costUSD?: number;
  };
  /** Escalation metadata when this attempt is an escalation promotion */
  escalation?: RunAttemptEscalation;
}

export interface RunLogEvent {
  runId: string;
  ts: string;
  taskId: string;
  taskType: TaskType;
  difficulty: Difficulty;
  routing: RoutingDecision;
  expectedCostUSD: number | null;
  /** Actual cost in USD from last attempt when usage is available */
  actualCostUSD?: number;
  /** Quality score from evaluator when available */
  qualityScore?: number;
  attempts: RunAttempt[];
  final: {
    status: "ok" | "failed" | "no_qualified_models";
    chosenModelId: string | null;
    retryUsed: boolean;
    /** Whether escalation was used (Stage 5) */
    escalationUsed?: boolean;
    /** Minimal escalation decision summary */
    escalationDecision?: {
      initialScore: number;
      threshold: number;
      escalatedScore?: number;
      chosenAttempt: "initial" | "escalated";
      reason?: string;
      /** Single-line summary for UI: "Escalation: 4o-mini 0.81 < 0.88 → promoted to gpt-4o 0.90 (chosen)" */
      summary?: string;
    };
  };
  /** Stage 5.3: Policy evaluation for escalation-aware routing (shadow-mode metrics) */
  policyEval?: {
    enabled: boolean;
    selectionPolicy: "lowest_cost_qualified" | "best_value";
    routingMode: "normal" | "escalation_aware";
    taskType: TaskType;
    difficulty: Difficulty;
    profile: string;
    normalChoice: {
      modelId: string;
      expectedCostUSD: number;
      threshold: number;
      expertise: number;
      rawConfidence?: number;
      rationale?: string;
    };
    chosenAttempt1: {
      modelId: string;
      expectedCostUSD: number;
      expertise: number;
      rawConfidence?: number;
    };
    usedCheapFirst: boolean;
    estimatedSavingsUSD: number;
    estimatedSavingsPct: number;
    promotionTargetId?: string;
    worstCaseExpectedCostUSD?: number;
    gateReason?: string;
    /** When cheap-first rejected, breakdown of why models failed (by gate) */
    gateRejectionCounts?: {
      savingsPct: number;
      confidence: number;
      gap: number;
      noPromotionTarget: number;
      budget: number;
    };
    /** Stage 6.3: Primary gate that eliminated all candidates */
    primaryBlocker?: "savingsPct" | "confidence" | "gap" | "noPromotionTarget" | "budget" | "no_cheap_first_candidates" | "premium_lane";
    /** Premium lane: cheap-first disabled for this task type */
    premiumLane?: boolean;
    premiumTaskType?: TaskType;
    /** Stage 6.3: Candidate counts after each gate (when cheap-first failed) */
    gateProgress?: {
      initial: number;
      afterSavings: number;
      afterConfidence: number;
      afterGap: number;
      afterPromotion: number;
      afterBudget: number;
    };
    result: {
      escalationUsed: boolean;
      finalModelId: string;
      initialScore?: number;
      finalScore?: number;
      targetScore?: number;
      effectiveThreshold?: number;
      realizedAttempt1CostUSD?: number;
      realizedTotalCostUSD?: number;
    };
  };
}
