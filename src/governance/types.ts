/**
 * Governance / Executive Council types.
 */

export interface CeoDirectiveRequest {
  directive: string;
  domain?: string;
  businessContext?: string;
  successMetrics?: string[];
  timeHorizon?: string;
  projectBudgetUSD?: number;
  governanceBudgetUSD?: number;
  riskTolerance?: "low" | "medium" | "high";
  speedPreference?: "fast" | "balanced" | "thorough";
  complianceNotes?: string[];
}

export interface ExecOption {
  id: "A" | "B" | "C";
  name: string;
  summary: string;
  approach: string[];
  pros: string[];
  cons: string[];
  dependencies: string[];
  risks: string[];
  roughCostUSD: { low: number; likely: number; high: number };
  roughTimeline: { lowWeeks: number; likelyWeeks: number; highWeeks: number };
  expectedImpact: {
    metric: string;
    low: number;
    likely: number;
    high: number;
    unit: "%" | "count" | "usd" | "time";
  };
}

export interface ExecutiveDraft {
  modelId: string;
  problemStatement: string;
  assumptions: string[];
  missingInfo: string[];
  clarifyingQuestions: string[];
  options: ExecOption[];
  recommendedOptionId: "A" | "B" | "C";
  confidence: number;
  rationale: string;
}

export interface StrategyBrief {
  objective: string;
  scope: { in: string[]; out: string[] };
  assumptions: string[];
  keyUnknowns: string[];
  questionsForCEO: string[];
  options: ExecOption[];
  recommendedOptionId: "A" | "B" | "C";
  recommendedPlan: {
    workstreams: { name: string; description: string; ownerRole: string }[];
    phases: { name: string; deliverables: string[]; exitCriteria: string[] }[];
    kpis: { name: string; target: string; measurement: string }[];
  };
  governance: {
    decisionLog: string[];
    riskRegister: {
      risk: string;
      severity: "low" | "med" | "high";
      mitigation: string;
    }[];
    complianceChecklist: string[];
  };
  downstreamBudgetEstimateUSD: { low: number; likely: number; high: number };
  confidence: number;
}

export interface BriefScore {
  completeness: number;
  feasibility: number;
  measurability: number;
  riskCoverage: number;
  costPlausibility: number;
  consensus: number;
  overall: number;
  reasons: string[];
}

export interface GateDecision {
  status: "approve" | "needs_clarification" | "reject";
  requiredQuestions?: string[];
  notes: string[];
}

export interface ExecutiveCouncilRun {
  runId: string;
  ts: string;
  request: CeoDirectiveRequest;
  governanceBudgetUSD: number;
  drafts: {
    modelId: string;
    text: string;
    parsed?: ExecutiveDraft;
    actualCostUSD?: number;
  }[];
  consensus: {
    modelId: string;
    text: string;
    parsed?: StrategyBrief;
    actualCostUSD?: number;
  };
  scoring: BriefScore;
  gate: GateDecision;
  totalActualCostUSD?: number;
}
