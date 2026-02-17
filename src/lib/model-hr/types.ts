/**
 * Model HR type definitions.
 */

export type ModelStatus = "active" | "probation" | "deprecated" | "disabled";

export interface ModelIdentity {
  provider: string;
  modelId: string;
  aliases?: string[];
  version?: string;
  status: ModelStatus;
  releasedAtISO?: string;
  deprecatedAtISO?: string;
  disabledAtISO?: string;
  disabledReason?: string;
}

export interface ModelPricing {
  inPer1k: number;
  outPer1k: number;
  currency: "USD" | string;
  minimumChargeUSD?: number;
  roundingRule?: "perToken" | "per1k" | "perRequest";
}

export interface ModelCapabilities {
  modalities?: ("text" | "image" | "audio" | "vision")[];
  toolUse?: boolean;
  jsonReliability?: "native" | "prompted" | "unreliable";
  contextWindowTokens?: number;
  functionCalling?: boolean;
  streaming?: boolean;
  reasoning?: boolean;
}

export interface ModelGuardrails {
  safetyCategory?: "standard" | "high" | "restricted";
  highRiskFlag?: boolean;
  restrictedUseCases?: string[];
  complianceTags?: string[];
}

export interface ModelOperational {
  rateLimitRPM?: number;
  rateLimitTPM?: number;
  latencySLOms?: number;
  stability?: "stable" | "beta" | "experimental";
  regions?: string[];
}

export interface ModelPerformancePrior {
  taskType: string;
  difficulty: string;
  qualityPrior: number;
  costMultiplier: number;
  calibrationConfidence: number;
  varianceBandLow?: number;
  varianceBandHigh?: number;
  lastUpdatedISO: string;
  sampleCount: number;
  /** Optional: avg(defectCount>0) for slice; high defectRate may reduce qualityPrior */
  defectRate?: number;
}

export interface EligibilityRule {
  condition: "always" | "whenBudgetAbove" | "whenImportanceBelow";
  params?: Record<string, unknown>;
}

/** Per-model canary thresholds; defaults used when undefined. */
export interface CanaryThresholds {
  /** Quality below this => probation. Default 0.70 */
  probationQuality?: number;
  /** Quality >= this and failedCount 0 => active. Default 0.82 */
  graduateQuality?: number;
  /** failedCount >= this => probation. Default 2 */
  probationFailCount?: number;
}

export interface ModelGovernance {
  allowedTiers?: ("cheap" | "standard" | "premium")[];
  defaultTierProfile?: "cheap" | "standard" | "premium";
  eligibilityRules?: EligibilityRule[];
  /** Provider IDs to block (e.g. ["openai"]); model ineligible when identity.provider matches */
  blockedProviders?: string[];
  /** Task types this model cannot handle; ineligible when ctx.taskType matches */
  blockedTaskTypes?: string[];
  /** Manual kill switch: model ineligible when true */
  killSwitch?: boolean;
  /** Auto probation: avg cost variance ratio above this => probation (sampleCount >= 30) */
  maxCostVarianceRatio?: number;
  /** Auto probation: quality prior below this => probation (sampleCount >= 30) */
  minQualityPrior?: number;
  /** Auto probation/disable: max recent escalations over last N observations (future use) */
  maxRecentEscalations?: number;
  /** When true, never auto-disable; probation only */
  disableAutoDisable?: boolean;
  /** Per-model canary thresholds; overrides defaults when present */
  canaryThresholds?: CanaryThresholds;
}

export interface ModelEvaluationMeta {
  lastBenchmarkISO?: string;
  canaryStatus?: "none" | "running" | "passed" | "failed";
  regressionIndicators?: string[];
}

/** Score explainability: breakdown of Model HR score components */
export interface ModelScoreBreakdown {
  baseReliability: number;
  expertiseComponent: number;
  priorQualityComponent: number;
  statusPenalty: number;
  costPenalty: number;
  adjustedCostUSD: number;
  finalScore: number;
}

export interface ModelRegistryEntry {
  id: string;
  identity: ModelIdentity;
  displayName?: string;
  pricing: ModelPricing;
  expertise?: Record<string, number>;
  reliability?: number;
  capabilities?: ModelCapabilities;
  guardrails?: ModelGuardrails;
  operational?: ModelOperational;
  performancePriors?: ModelPerformancePrior[];
  governance?: ModelGovernance;
  evaluationMeta?: ModelEvaluationMeta;
  createdAtISO: string;
  updatedAtISO: string;
}

/** QA mode for the observation: deterministic-only, LLM-only, or both (hybrid) */
export type QaMode = "deterministic" | "llm" | "hybrid";

export interface ModelObservation {
  modelId: string;
  taskType: string;
  difficulty: string;
  actualCostUSD: number;
  predictedCostUSD: number;
  actualQuality: number;
  predictedQuality: number;
  tsISO: string;
  runSessionId?: string;
  packageId?: string;
  /** Optional QA feedback: number of defects reported */
  defectCount?: number;
  /** Optional: tags/categories derived from defects (e.g. first token) */
  defectTags?: string[];
  /** Optional: sample defect strings (truncated) for HR learning */
  defectSamples?: string[];
  /** How QA was performed: deterministic shell checks, LLM, or both */
  qaMode?: QaMode;
  /** True when deterministic ran but all checks were skipped (no signal) */
  deterministicNoSignal?: boolean;
  /** True when LLM QA was skipped due to budget gating */
  budgetGated?: boolean;
}

export interface ListModelsFilters {
  status?: ModelStatus | ModelStatus[];
  provider?: string;
  tiers?: ("cheap" | "standard" | "premium")[];
  taskType?: string;
  includeDisabled?: boolean;
}

export interface ModelScoreContext {
  taskType: string;
  difficulty: string;
  tierProfile: "cheap" | "standard" | "premium";
  budgetRemaining: number;
  importance?: number;
}
