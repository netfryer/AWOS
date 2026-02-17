/**
 * Governance schemas: planning, consensus, risk, work packages, QA, trust, escalation.
 * JSON-serializable types + Zod validation for API endpoints.
 */

import { z } from "zod";

// ─── Enums ─────────────────────────────────────────────────────────────────

export const ConsensusMethod = z.enum(["majority", "weighted", "unanimous"]);
export type ConsensusMethod = z.infer<typeof ConsensusMethod>;

export const EscalationReason = z.enum([
  "budget_exceeded",
  "quality_threshold",
  "risk_triggered",
  "deadline_miss",
  "stakeholder_conflict",
  "compliance_breach",
  "other",
]);
export type EscalationReason = z.infer<typeof EscalationReason>;

export const EscalationAction = z.enum([
  "pause",
  "escalate_to_ceo",
  "request_budget",
  "revise_plan",
  "accept_risk",
  "reject",
]);
export type EscalationAction = z.infer<typeof EscalationAction>;

export const WorkRole = z.enum([
  "owner",
  "contributor",
  "reviewer",
  "approver",
  "stakeholder",
]);
export type WorkRole = z.infer<typeof WorkRole>;

// ─── Core Schemas ─────────────────────────────────────────────────────────

export const RiskItemSchema = z.object({
  id: z.string(),
  risk: z.string(),
  severity: z.enum(["low", "med", "high"]),
  mitigation: z.string(),
  likelihood: z.number().min(0).max(1).optional(),
});
export type RiskItem = z.infer<typeof RiskItemSchema>;

export const WorkPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  ownerRole: WorkRole,
  deliverables: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  estimatedHours: z.number().nonnegative().optional(),
});
export type WorkPackage = z.infer<typeof WorkPackageSchema>;

export const CouncilVoteSchema = z.object({
  modelId: z.string(),
  optionId: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
});
export type CouncilVote = z.infer<typeof CouncilVoteSchema>;

export const ScoreBundleSchema = z.object({
  completeness: z.number().min(0).max(1),
  feasibility: z.number().min(0).max(1),
  measurability: z.number().min(0).max(1),
  riskCoverage: z.number().min(0).max(1),
  qaScore: z.number().min(0).max(1).optional(),
  overall: z.number().min(0).max(1),
  reasons: z.array(z.string()).optional(),
});
export type ScoreBundle = z.infer<typeof ScoreBundleSchema>;

export const ModelTrustProfileSchema = z.object({
  modelId: z.string(),
  trustScore: z.number().min(0).max(1),
  evaluatedRuns: z.number().int().nonnegative(),
  avgQualityScore: z.number().min(0).max(1).optional(),
  lastUpdated: z.string().datetime().optional(),
});
export type ModelTrustProfile = z.infer<typeof ModelTrustProfileSchema>;

export const EscalationEventSchema = z.object({
  id: z.string(),
  ts: z.string().datetime(),
  reason: EscalationReason,
  action: EscalationAction,
  context: z.record(z.string(), z.unknown()).optional(),
  resolved: z.boolean().optional(),
  resolvedAt: z.string().datetime().optional(),
});
export type EscalationEvent = z.infer<typeof EscalationEventSchema>;

export const ProjectPlanSchema = z.object({
  id: z.string(),
  objective: z.string(),
  workPackages: z.array(WorkPackageSchema),
  risks: z.array(RiskItemSchema).optional(),
  scoreBundle: ScoreBundleSchema.optional(),
  escalationEvents: z.array(EscalationEventSchema).optional(),
  createdAt: z.string().datetime().optional(),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeConsensusScore(
  votes: CouncilVote[],
  method: ConsensusMethod,
  trustMap: Map<string, number>
): number {
  if (votes.length === 0) return 0;

  const optionCounts = new Map<string, number>();

  for (const v of votes) {
    const trust = trustMap.get(v.modelId) ?? 0.5;
    const weight = method === "weighted" ? trust * v.confidence : 1;
    optionCounts.set(v.optionId, (optionCounts.get(v.optionId) ?? 0) + weight);
  }

  const entries = [...optionCounts.entries()];
  if (entries.length === 0) return 0;

  const maxWeight = Math.max(...entries.map(([, w]) => w));
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);

  if (method === "unanimous") {
    const winningOption = entries.find(([, w]) => w === maxWeight)?.[0];
    const allSame = votes.every((v) => v.optionId === winningOption);
    return allSame && votes.length > 0 ? 1 : 0;
  }

  return totalWeight > 0 ? clamp01(maxWeight / totalWeight) : 0;
}

export function computePlanConfidence(
  consensusScore: number,
  avgTrust: number,
  riskScore: number
): number {
  const consensusWeight = 0.4;
  const trustWeight = 0.35;
  const riskWeight = 0.25;
  const riskPenalty = 1 - riskScore;
  return clamp01(
    consensusScore * consensusWeight +
      clamp01(avgTrust) * trustWeight +
      riskPenalty * riskWeight
  );
}
