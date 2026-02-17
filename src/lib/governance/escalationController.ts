/**
 * Deterministic escalation evaluation and policy application.
 */

import { randomUUID } from "crypto";
import type { EscalationEvent, EscalationReason, EscalationAction } from "../schemas/governance.js";

export type RecommendedAction =
  | "RETRY_UPGRADE_TIER"
  | "SWITCH_MODEL"
  | "ADD_QA"
  | "SPLIT_TASK"
  | "COUNCIL_REPLAN";

export type Tier = "cheap" | "standard" | "premium";

export interface EscalationInput {
  planConfidence?: number;
  riskScore?: number;
  consensusScore?: number;
  underfunded?: boolean;
  subtaskImportance?: number;
  qaPass?: boolean;
  actualQuality?: number;
  predictedQuality?: number;
  actualCostUSD?: number;
  predictedCostUSD?: number;
  modelTrust?: number;
  modelId?: string;
}

const QUALITY_DROP_THRESHOLD = 0.25;
const COST_BLOWUP_MULTIPLIER = 1.5;
const LOW_TRUST_THRESHOLD = 0.35;
const HIGH_IMPORTANCE_THRESHOLD = 4;
const LOW_PLAN_CONFIDENCE_THRESHOLD = 0.4;
const LOW_CONSENSUS_THRESHOLD = 0.5;
const HIGH_RISK_THRESHOLD = 0.6;

function toIsoNow(): string {
  return new Date().toISOString();
}

function createEvent(
  reason: EscalationReason,
  action: EscalationAction,
  recommendedAction: RecommendedAction,
  context?: Record<string, unknown>
): EscalationEvent {
  return {
    id: randomUUID(),
    ts: toIsoNow(),
    reason,
    action,
    context: { recommendedAction, ...context },
  };
}

export function evaluateEscalation(input: EscalationInput): EscalationEvent[] {
  const events: EscalationEvent[] = [];

  if (input.planConfidence != null && input.planConfidence < LOW_PLAN_CONFIDENCE_THRESHOLD) {
    const highRisk = (input.riskScore ?? 0) >= HIGH_RISK_THRESHOLD;
    if (highRisk) {
      events.push(
        createEvent(
          "risk_triggered",
          "revise_plan",
          "COUNCIL_REPLAN",
          { planConfidence: input.planConfidence, riskScore: input.riskScore }
        )
      );
    }
  }

  if (input.consensusScore != null && input.consensusScore < LOW_CONSENSUS_THRESHOLD) {
    events.push(
      createEvent(
        "stakeholder_conflict",
        "revise_plan",
        "COUNCIL_REPLAN",
        { consensusScore: input.consensusScore }
      )
    );
  }

  if (input.underfunded === true) {
    events.push(
      createEvent("budget_exceeded", "request_budget", "COUNCIL_REPLAN", {
        underfunded: true,
      })
    );
  }

  if (
    input.subtaskImportance != null &&
    input.subtaskImportance >= HIGH_IMPORTANCE_THRESHOLD &&
    input.qaPass === false
  ) {
    events.push(
      createEvent(
        "quality_threshold",
        "revise_plan",
        "ADD_QA",
        {
          subtaskImportance: input.subtaskImportance,
          qaPass: input.qaPass,
        }
      )
    );
  }

  if (
    input.actualQuality != null &&
    input.predictedQuality != null &&
    input.actualQuality < input.predictedQuality - QUALITY_DROP_THRESHOLD
  ) {
    events.push(
      createEvent(
        "quality_threshold",
        "revise_plan",
        "SWITCH_MODEL",
        {
          actualQuality: input.actualQuality,
          predictedQuality: input.predictedQuality,
        }
      )
    );
  }

  if (
    input.actualCostUSD != null &&
    input.predictedCostUSD != null &&
    input.predictedCostUSD > 0 &&
    input.actualCostUSD > input.predictedCostUSD * COST_BLOWUP_MULTIPLIER
  ) {
    events.push(
      createEvent(
        "budget_exceeded",
        "request_budget",
        "RETRY_UPGRADE_TIER",
        {
          actualCostUSD: input.actualCostUSD,
          predictedCostUSD: input.predictedCostUSD,
        }
      )
    );
  }

  if (
    input.modelTrust != null &&
    input.modelTrust < LOW_TRUST_THRESHOLD
  ) {
    events.push(
      createEvent(
        "quality_threshold",
        "revise_plan",
        "SWITCH_MODEL",
        {
          modelTrust: input.modelTrust,
          modelId: input.modelId,
        }
      )
    );
  }

  return events;
}

export interface EscalationPolicyResult {
  newTier: Tier;
  forceModelIds?: string[];
  addQaPass?: boolean;
}

const TIER_ORDER: Tier[] = ["cheap", "standard", "premium"];

function nextTier(tier: Tier): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

export function applyEscalationPolicy(
  currentTier: Tier,
  event: EscalationEvent
): EscalationPolicyResult {
  const rec = event.context?.recommendedAction as RecommendedAction | undefined;

  switch (rec) {
    case "RETRY_UPGRADE_TIER":
      return {
        newTier: nextTier(currentTier),
      };
    case "SWITCH_MODEL":
      return {
        newTier: currentTier,
      };
    case "ADD_QA":
      return {
        newTier: currentTier,
        addQaPass: true,
      };
    case "SPLIT_TASK":
      return {
        newTier: currentTier,
      };
    case "COUNCIL_REPLAN":
      return {
        newTier: currentTier,
      };
    default:
      return {
        newTier: currentTier,
      };
  }
}
