/**
 * Task Router
 * Selects an LLM model for a task using:
 * 1) Expertise threshold gate (expertise first)
 * 2) Lowest expected cost among qualified models (cost second)
 * 3) If none qualify: behavior depends on config.onBudgetFail
 * Returns a RoutingDecision with fallback ladder and token estimates.
 */

import {
  TaskCard,
  ModelSpec,
  RoutingDecision,
  RouterConfig,
  TaskType,
  Difficulty,
  SelectionPolicy,
  EscalationConfig,
} from "./types.js";
import { selectEscalationModel } from "./escalation/selectEscalationModel.js";

/** Default guardrail values for best_value policy */
const DEFAULT_MIN_CONFIDENCE_TO_USE_CALIBRATION = 0.2;
const DEFAULT_CONFIDENCE_FLOOR = 0.1;
const DEFAULT_MIN_BENEFIT_BY_DIFFICULTY: Record<Difficulty, number> = {
  low: 0,
  medium: 0.02,
  high: 0.04,
};
const DEFAULT_MIN_BENEFIT_NEAR_THRESHOLD_BY_DIFFICULTY: Record<Difficulty, number> = {
  low: 0,
  medium: 0.01,
  high: 0.02,
};

/** Stage 5.2: default cheap-first config */
const DEFAULT_CHEAP_FIRST_MAX_GAP: Record<Difficulty, number> = {
  low: 0.06,
  medium: 0.08,
  high: 0.1,
};

/** Optional portfolio-aware routing params */
export interface PortfolioRoutingOptions {
  preferModelIds?: string[];
  allowedModelIds?: string[];
}

/** Bypass reason taxonomy for portfolio routing */
export type PortfolioBypassReason =
  | "no_allowed_models"
  | "allowed_models_over_budget"
  | "allowed_models_below_trust"
  | "allowed_models_below_quality"
  | "portfolio_not_provided";

/** Score breakdown for explainability (optional) */
export interface ModelScoreBreakdown {
  baseReliability: number;
  expertiseComponent: number;
  priorQualityComponent: number;
  statusPenalty: number;
  costPenalty: number;
  adjustedCostUSD: number;
  finalScore: number;
}

/** Value score for best_value policy (benefit/conf over cost) */
export interface ValueScoreEntry {
  valueScore: number;
  benefit: number;
  confidence: number;
}

/** Candidate audit entry for provable cheapest-viable selection */
export interface RoutingCandidateAuditEntry {
  modelId: string;
  predictedCostUSD: number;
  predictedQuality: number;
  passed: boolean;
  /** When selectionPolicy is best_value */
  valueScoreEntry?: ValueScoreEntry;
  /** Raw calibration confidence from map (best_value only) */
  rawConfidence?: number;
  /** Effective confidence used in valueScore (floored if raw < minConfidenceToUseCalibration) */
  effectiveConfidence?: number;
  /** Min confidence threshold to trust calibration (best_value only) */
  minConfidenceToUseCalibration?: number;
  /** Min benefit required for this difficulty (best_value only) */
  minBenefitRequired?: number;
  /** When excluded from best_value due to benefit guardrail */
  excludedReason?: string;
  disqualifiedReason?:
    | "below_quality"
    | "below_trust"
    | "over_budget"
    | "not_allowed_by_portfolio"
    | "procurement_not_subscribed"
    | "credentials_missing"
    | "procurement_blocked_model"
    | "procurement_blocked_provider"
    | "procurement_not_allowed";
  /** Model HR score [0..1] when available */
  score?: number;
  /** Score breakdown when Model HR scoring is used (not fallback) */
  scoreBreakdown?: ModelScoreBreakdown;
}

/** Prior slice used for qualification (effectiveQuality = prior.qualityPrior ?? expertise) */
export interface PriorForQualification {
  taskType: string;
  difficulty: string;
  qualityPrior: number;
}

/** Optional routing options for Model HR ranking and cheapest-viable assertion */
export interface RoutingOptions {
  /** Pre-computed scores by modelId (from ScoreService.computeModelScore) */
  candidateScores?: Map<string, number>;
  /** Score breakdowns by modelId when Model HR scoring is used */
  candidateScoreBreakdowns?: Map<string, ModelScoreBreakdown>;
  /** When true, enforce cheapest among passed (assertion mode); else choose best score. External API: cheapestViableChosen */
  cheapestViableChosen?: boolean;
  /** Priors per modelId; when present, qualification uses effectiveQuality = prior.qualityPrior ?? expertise */
  priorsByModel?: Map<string, PriorForQualification[]>;
  /** Calibration confidence by "modelId|taskType" for best_value policy */
  calibrationConfidence?: Map<string, number>;
  /** Escalation config for Stage 5.2 escalation-aware routing */
  escalationConfig?: EscalationConfig;
}

/** Gate rejection counts when cheap-first was considered but no candidate chosen (for policy stats) */
export interface GateRejectionCounts {
  savingsPct: number;
  confidence: number;
  gap: number;
  noPromotionTarget: number;
  budget: number;
}

/** Primary gate that eliminated the last candidate (Stage 6.3) */
export type PrimaryBlocker =
  | "savingsPct"
  | "confidence"
  | "gap"
  | "noPromotionTarget"
  | "budget"
  | "no_cheap_first_candidates";

/** Gate progress through sequential filtering (Stage 6.3) */
export interface GateProgress {
  initial: number;
  afterSavings: number;
  afterConfidence: number;
  afterGap: number;
  afterPromotion: number;
  afterBudget: number;
}

/** Escalation-aware routing audit (Stage 5.2) */
export interface EscalationAwareAudit {
  enabled: boolean;
  normalChoice: { modelId: string; expectedCostUSD: number; Q: number; conf: number };
  /** Premium lane: cheap-first disabled for this task type */
  premiumLane?: boolean;
  premiumLaneReason?: string;
  cheapFirstChoice?: {
    modelId: string;
    expectedCostUSD: number;
    Q: number;
    conf: number;
    promotionTargetId: string;
    worstCaseExpectedCostUSD: number;
  };
  reason?: string;
  savingsUSD?: number;
  maxGap?: number;
  /** When reason is rejected: no_cheap_first_candidates, breakdown of why models failed */
  gateRejectionCounts?: GateRejectionCounts;
  /** Raw calibration confidence by modelId for this taskType (for debugging thresholds) */
  calibrationConfidenceByModel?: Record<string, number>;
  /** Stage 6.3: First gate that eliminated all remaining candidates */
  primaryBlocker?: PrimaryBlocker;
  /** Stage 6.3: Candidate counts after each gate */
  gateProgress?: GateProgress;
}

/** RoutingDecision with optional audit (extends base without changing API) */
type RoutingDecisionWithAudit = RoutingDecision & {
  routingAudit?: {
    candidates: RoutingCandidateAuditEntry[];
    enforceCheapestViable?: boolean;
    chosenIsCheapestViable?: boolean;
    rankedBy?: "score" | "cheapest_viable" | "best_value" | "best_value_near_threshold" | "escalation_aware";
    noQualifiedBestValueEntry?: ValueScoreEntry;
    escalationAware?: EscalationAwareAudit;
  };
};

const PREFER_BONUS_DEFAULT = 0.03;
const PREFER_BONUS_BY_DIFFICULTY: Record<string, number> = {
  low: 0.01,
  medium: 0.03,
  high: 0.05,
};

function getPreferBonus(difficulty?: string): number {
  return difficulty && PREFER_BONUS_BY_DIFFICULTY[difficulty] != null
    ? PREFER_BONUS_BY_DIFFICULTY[difficulty]
    : PREFER_BONUS_DEFAULT;
}

/** Default token estimates when not specified per task type */
const DEFAULT_INPUT_TOKENS = 2000;
const DEFAULT_OUTPUT_TOKENS = 1000;

const DEFAULT_NEAR_THRESHOLD_DELTA: Record<string, number> = {
  low: 0.04,
  medium: 0.06,
  high: 0.1,
};

/** Default router config matching original behavior */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  thresholds: { low: 0.7, medium: 0.8, high: 0.88 },
  baseTokenEstimates: {
    input: {},
    output: {},
  },
  difficultyMultipliers: { low: 1, medium: 1, high: 1 },
  fallbackCount: 2,
  onBudgetFail: "best_effort_within_budget",
  selectionPolicy: "lowest_cost_qualified",
  noQualifiedPolicy: "highest_expertise",
  nearThresholdDeltaByDifficulty: { low: 0.04, medium: 0.06, high: 0.1 },
  minConfidenceToUseCalibration: DEFAULT_MIN_CONFIDENCE_TO_USE_CALIBRATION,
  confidenceFloor: DEFAULT_CONFIDENCE_FLOOR,
  minBenefitByDifficulty: { ...DEFAULT_MIN_BENEFIT_BY_DIFFICULTY },
  minBenefitNearThresholdByDifficulty: { ...DEFAULT_MIN_BENEFIT_NEAR_THRESHOLD_BY_DIFFICULTY },
};

/** Minimum total tokens to avoid gross underestimate from short directive (e.g. "Implement X"). */
const MIN_TOTAL_TOKENS_DIRECTIVE = 800;

/**
 * Directive-based token estimation (lower, more realistic).
 * Uses directive length when present; falls back to baseTokenEstimates otherwise.
 * When directive is short and yields < MIN_TOTAL_TOKENS_DIRECTIVE, uses base estimates
 * to avoid budget_exceeded escalations from underestimated predictedCostUSD.
 */
export function estimateTokensForTask(
  task: TaskCard,
  directive?: string,
  config?: Partial<RouterConfig>
): { input: number; output: number } {
  const cfg = config ?? DEFAULT_ROUTER_CONFIG;
  const mult = cfg.difficultyMultipliers?.[task.difficulty] ?? 1;

  const baseInput =
    cfg.baseTokenEstimates?.input?.[task.taskType] ?? DEFAULT_INPUT_TOKENS;
  const baseOutput =
    cfg.baseTokenEstimates?.output?.[task.taskType] ?? DEFAULT_OUTPUT_TOKENS;
  const fallbackEst = {
    input: Math.round(baseInput * mult),
    output: Math.round(baseOutput * mult),
  };

  if (directive != null && String(directive).trim().length > 0) {
    const len = String(directive).trim().length;
    const rawInput = Math.round(len / 4);
    const rawOutput = Math.round(rawInput * 0.6);
    const input = Math.max(200, Math.min(6000, rawInput));
    const output = Math.max(100, Math.min(2500, rawOutput));
    const directiveEst = {
      input: Math.round(input * mult),
      output: Math.round(output * mult),
    };
    const total = directiveEst.input + directiveEst.output;
    if (total >= MIN_TOTAL_TOKENS_DIRECTIVE) {
      return directiveEst;
    }
  }

  return fallbackEst;
}

/**
 * Internal: uses estimateTokensForTask with optional directive.
 */
function computeEstimatedTokens(
  task: TaskCard,
  config: RouterConfig,
  directive?: string
): { input: number; output: number } {
  return estimateTokensForTask(task, directive, config);
}

/**
 * Computes expected cost in USD for a model given token estimates.
 * cost = (input/1000)*inPer1k + (output/1000)*outPer1k
 */
function computeExpectedCost(
  model: ModelSpec,
  estimatedTokens: { input: number; output: number }
): number {
  const inputCost =
    (estimatedTokens.input / 1000) * model.pricing.inPer1k;
  const outputCost =
    (estimatedTokens.output / 1000) * model.pricing.outPer1k;
  return inputCost + outputCost;
}

/**
 * Gets the expertise threshold for a task.
 * threshold = max(config.thresholds[difficulty], task.constraints.minQuality ?? 0)
 */
export function getThresholdForTask(
  task: TaskCard,
  config: Partial<RouterConfig>
): number {
  const cfg = {
    ...DEFAULT_ROUTER_CONFIG,
    ...config,
    thresholds: { ...DEFAULT_ROUTER_CONFIG.thresholds, ...config?.thresholds },
  };
  const baseThreshold = cfg.thresholds[task.difficulty];
  const minQuality = task.constraints?.minQuality ?? 0;
  return Math.max(baseThreshold, minQuality);
}

function getThreshold(task: TaskCard, config: RouterConfig): number {
  const baseThreshold = config.thresholds[task.difficulty];
  const minQuality = task.constraints?.minQuality ?? 0;
  return Math.max(baseThreshold, minQuality);
}

/**
 * Returns the model's expertise for the task's type.
 */
function getExpertise(model: ModelSpec, taskType: TaskType): number {
  return model.expertise[taskType] ?? 0;
}

/**
 * Returns effective quality for qualification: prior.qualityPrior ?? registry.expertise.
 * When priorsByModel has a matching prior for (modelId, taskType, difficulty), use qualityPrior; else expertise.
 */
function getEffectiveQuality(
  model: ModelSpec,
  taskType: TaskType,
  difficulty: Difficulty,
  priorsByModel?: Map<string, PriorForQualification[]>
): number {
  if (!priorsByModel) return getExpertise(model, taskType);
  const priors = priorsByModel.get(model.id);
  if (!priors?.length) return getExpertise(model, taskType);
  const prior = priors.find((p) => p.taskType === taskType && p.difficulty === difficulty);
  return prior?.qualityPrior ?? getExpertise(model, taskType);
}

/**
 * Filters models that meet: effectiveQuality >= threshold AND (if maxCostUSD) cost <= maxCostUSD.
 * effectiveQuality = prior.qualityPrior ?? expertise when priorsByModel is provided.
 */
function filterQualified(
  task: TaskCard,
  models: ModelSpec[],
  estimatedTokens: { input: number; output: number },
  threshold: number,
  priorsByModel?: Map<string, PriorForQualification[]>
): ModelSpec[] {
  const maxCost = task.constraints?.maxCostUSD;
  return models.filter((m) => {
    const effectiveQuality = getEffectiveQuality(m, task.taskType, task.difficulty, priorsByModel);
    if (effectiveQuality < threshold) return false;
    if (maxCost != null) {
      const cost = computeExpectedCost(m, estimatedTokens);
      if (cost > maxCost) return false;
    }
    return true;
  });
}

/**
 * Filters models within budget (cost <= maxCostUSD).
 * Used for best_effort_within_budget when no models qualify.
 */
function filterWithinBudget(
  models: ModelSpec[],
  maxCostUSD: number,
  estimatedTokens: { input: number; output: number }
): ModelSpec[] {
  return models.filter(
    (m) => computeExpectedCost(m, estimatedTokens) <= maxCostUSD
  );
}

/**
 * Sorts models by: cost asc, reliability desc, expertise desc.
 * Optionally applies difficulty-scaled prefer bonus to expertise for models in preferModelIds.
 */
function sortByCostReliabilityExpertise(
  models: ModelSpec[],
  taskType: TaskType,
  estimatedTokens: { input: number; output: number },
  preferModelIds?: string[],
  difficulty?: string
): ModelSpec[] {
  const preferSet = preferModelIds?.length ? new Set(preferModelIds) : undefined;
  const bonus = getPreferBonus(difficulty);
  const score = (m: ModelSpec) => {
    const exp = getExpertise(m, taskType);
    return exp + (preferSet?.has(m.id) ? bonus : 0);
  };
  return [...models].sort((a, b) => {
    const costA = computeExpectedCost(a, estimatedTokens);
    const costB = computeExpectedCost(b, estimatedTokens);
    if (costA !== costB) return costA - costB;
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    return score(b) - score(a);
  });
}

/**
 * Sorts models by: expertise desc, reliability desc, cost asc.
 * Optionally applies difficulty-scaled prefer bonus to expertise for models in preferModelIds.
 */
function sortByExpertiseReliabilityCost(
  models: ModelSpec[],
  taskType: TaskType,
  estimatedTokens: { input: number; output: number },
  preferModelIds?: string[],
  difficulty?: string
): ModelSpec[] {
  const preferSet = preferModelIds?.length ? new Set(preferModelIds) : undefined;
  const bonus = getPreferBonus(difficulty);
  const score = (m: ModelSpec) => {
    const exp = getExpertise(m, taskType);
    return exp + (preferSet?.has(m.id) ? bonus : 0);
  };
  return [...models].sort((a, b) => {
    const expA = score(a);
    const expB = score(b);
    if (expB !== expA) return expB - expA;
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    return (
      computeExpectedCost(a, estimatedTokens) -
      computeExpectedCost(b, estimatedTokens)
    );
  });
}

/** Guardrail config for best_value policy */
interface BestValueGuardrails {
  minConfidenceToUseCalibration: number;
  confidenceFloor: number;
  minBenefitByDifficulty: Record<Difficulty, number>;
  minBenefitNearThresholdByDifficulty: Record<Difficulty, number>;
}

function getBestValueGuardrails(cfg: RouterConfig): BestValueGuardrails {
  return {
    minConfidenceToUseCalibration: cfg.minConfidenceToUseCalibration ?? DEFAULT_MIN_CONFIDENCE_TO_USE_CALIBRATION,
    confidenceFloor: cfg.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR,
    minBenefitByDifficulty: { ...DEFAULT_MIN_BENEFIT_BY_DIFFICULTY, ...cfg.minBenefitByDifficulty },
    minBenefitNearThresholdByDifficulty: {
      ...DEFAULT_MIN_BENEFIT_NEAR_THRESHOLD_BY_DIFFICULTY,
      ...cfg.minBenefitNearThresholdByDifficulty,
    },
  };
}

/**
 * Computes valueScore for best_value policy.
 * valueScore = (benefit * max(0.1, effectiveConf)) / (C + 0.0001)
 * effectiveConf = rawConf >= minConfidenceToUseCalibration ? rawConf : confidenceFloor
 * @param effectiveThreshold - threshold for benefit; use (threshold - delta) for near-threshold fallback
 */
function computeValueScore(
  model: ModelSpec,
  taskType: TaskType,
  effectiveThreshold: number,
  estimatedTokens: { input: number; output: number },
  calibrationConfidence: Map<string, number>,
  guardrails: BestValueGuardrails
): { valueScore: number; benefit: number; rawConfidence: number; effectiveConfidence: number } {
  const Q = getExpertise(model, taskType);
  const benefit = Math.max(0, Q - effectiveThreshold);
  const key = `${model.id}|${taskType}`;
  const rawConf = calibrationConfidence.get(key) ?? 0.1;
  const effectiveConf =
    rawConf >= guardrails.minConfidenceToUseCalibration ? rawConf : guardrails.confidenceFloor;
  const C = computeExpectedCost(model, estimatedTokens);
  const valueScore = (benefit * Math.max(0.1, effectiveConf)) / (C + 0.0001);
  return { valueScore, benefit, rawConfidence: rawConf, effectiveConfidence: effectiveConf };
}

/**
 * Selects model by best value (benefit*conf/cost) among qualified.
 * Excludes candidates with benefit < minBenefitByDifficulty[difficulty].
 * If all excluded, returns null (caller falls back to highest-expertise).
 */
function selectByBestValue(
  qualified: ModelSpec[],
  taskType: TaskType,
  difficulty: Difficulty,
  threshold: number,
  estimatedTokens: { input: number; output: number },
  calibrationConfidence: Map<string, number>,
  guardrails: BestValueGuardrails
): { model: ModelSpec; valueScoreEntry: ValueScoreEntry } | null {
  const minBenefit = guardrails.minBenefitByDifficulty[difficulty] ?? 0;
  const withScores = qualified.map((m) => {
    const Q = getExpertise(m, taskType);
    const benefit = Math.max(0, Q - threshold);
    const vs = computeValueScore(m, taskType, threshold, estimatedTokens, calibrationConfidence, guardrails);
    const C = computeExpectedCost(m, estimatedTokens);
    const excluded = benefit < minBenefit;
    return {
      m,
      ...vs,
      cost: C,
      expertise: Q,
      benefit,
      excluded,
      minBenefit,
    };
  });
  const eligible = withScores.filter((x) => !x.excluded);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    if (b.expertise !== a.expertise) return b.expertise - a.expertise;
    return a.cost - b.cost;
  });
  const chosen = eligible[0];
  return {
    model: chosen.m,
    valueScoreEntry: {
      valueScore: chosen.valueScore,
      benefit: chosen.benefit,
      confidence: chosen.effectiveConfidence,
    },
  };
}

/** Return type of selectByBestValueNearThreshold when non-null */
interface BestValueNearThresholdResult {
  model: ModelSpec;
  valueScoreEntry: ValueScoreEntry;
  rawConfidence: number;
  effectiveConfidence: number;
  minConfidenceToUseCalibration: number;
}

/**
 * Selects model by best value among near-threshold models (expertise >= threshold - delta).
 * Uses effectiveThreshold = threshold - delta for benefit computation.
 * Excludes candidates with benefitNear < minBenefitNearThresholdByDifficulty[difficulty].
 * If all excluded, returns null (caller falls back to highest-expertise).
 */
function selectByBestValueNearThreshold(
  nearModels: ModelSpec[],
  taskType: TaskType,
  difficulty: Difficulty,
  threshold: number,
  delta: number,
  estimatedTokens: { input: number; output: number },
  calibrationConfidence: Map<string, number>,
  guardrails: BestValueGuardrails
): BestValueNearThresholdResult | null {
  const effectiveThreshold = threshold - delta;
  const minBenefitNear = guardrails.minBenefitNearThresholdByDifficulty[difficulty] ?? 0;
  const withScores = nearModels.map((m) => {
    const Q = getExpertise(m, taskType);
    const benefitNear = Math.max(0, Q - effectiveThreshold);
    const vs = computeValueScore(m, taskType, effectiveThreshold, estimatedTokens, calibrationConfidence, guardrails);
    const C = computeExpectedCost(m, estimatedTokens);
    const excluded = benefitNear < minBenefitNear;
    return {
      m,
      ...vs,
      cost: C,
      expertise: Q,
      benefit: benefitNear,
      excluded,
      minBenefitNear,
    };
  });
  const eligible = withScores.filter((x) => !x.excluded);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    if (b.expertise !== a.expertise) return b.expertise - a.expertise;
    return a.cost - b.cost;
  });
  const chosen = eligible[0];
  return {
    model: chosen.m,
    valueScoreEntry: {
      valueScore: chosen.valueScore,
      benefit: chosen.benefit,
      confidence: chosen.effectiveConfidence,
    },
    rawConfidence: chosen.rawConfidence,
    effectiveConfidence: chosen.effectiveConfidence,
    minConfidenceToUseCalibration: guardrails.minConfidenceToUseCalibration,
  };
}

/**
 * Builds candidate audit list for provable cheapest-viable selection.
 * Captures each model's predictedCostUSD, predictedQuality, eligibility, and disqualifiedReason if filtered.
 */
function buildRoutingAudit(
  models: ModelSpec[],
  task: TaskCard,
  taskType: TaskType,
  estimatedTokens: { input: number; output: number },
  threshold: number,
  qualified: ModelSpec[],
  workingModels: ModelSpec[],
  hasAllowedFilter: boolean,
  allowedModelIds: string[] | undefined,
  candidateScores?: Map<string, number>,
  candidateScoreBreakdowns?: Map<string, ModelScoreBreakdown>,
  priorsByModel?: Map<string, PriorForQualification[]>,
  selectionPolicy?: SelectionPolicy,
  calibrationConfidence?: Map<string, number>,
  guardrails?: BestValueGuardrails
): { candidates: RoutingCandidateAuditEntry[] } {
  const qualifiedIds = new Set(qualified.map((m) => m.id));
  const maxCost = task.constraints?.maxCostUSD;
  const withinBudget =
    maxCost != null
      ? filterWithinBudget(workingModels, maxCost, estimatedTokens)
      : workingModels;
  const withinBudgetIds = new Set(withinBudget.map((m) => m.id));
  const allowedSet = hasAllowedFilter && allowedModelIds?.length ? new Set(allowedModelIds) : null;

  const candidates: RoutingCandidateAuditEntry[] = models.map((m) => {
    const predictedCostUSD = computeExpectedCost(m, estimatedTokens);
    const predictedQuality = getEffectiveQuality(m, taskType, task.difficulty, priorsByModel);
    let passed: boolean;
    let disqualifiedReason: RoutingCandidateAuditEntry["disqualifiedReason"] | undefined;

    if (allowedSet && !allowedSet.has(m.id)) {
      passed = false;
      disqualifiedReason = "not_allowed_by_portfolio";
    } else {
      const meetsQuality = predictedQuality >= threshold;
      const meetsBudget = maxCost == null || predictedCostUSD <= maxCost;
      if (qualifiedIds.has(m.id)) {
        passed = true;
      } else if (qualified.length > 0) {
        passed = false;
        disqualifiedReason = !meetsQuality ? "below_quality" : "over_budget";
      } else {
        passed = withinBudgetIds.has(m.id);
        if (!passed) disqualifiedReason = !meetsQuality ? "below_quality" : "over_budget";
      }
    }

    const entry: RoutingCandidateAuditEntry = {
      modelId: m.id,
      predictedCostUSD,
      predictedQuality,
      passed,
    };
    if (disqualifiedReason) entry.disqualifiedReason = disqualifiedReason;
    if (candidateScores?.has(m.id)) entry.score = candidateScores.get(m.id);
    if (candidateScoreBreakdowns?.has(m.id)) entry.scoreBreakdown = candidateScoreBreakdowns.get(m.id);
    if (
      selectionPolicy === "best_value" &&
      calibrationConfidence &&
      calibrationConfidence.size > 0 &&
      guardrails &&
      qualifiedIds.has(m.id)
    ) {
      const Q = getExpertise(m, taskType);
      const benefit = Math.max(0, Q - threshold);
      const minBenefitReq = guardrails.minBenefitByDifficulty[task.difficulty] ?? 0;
      const excludedByBenefit = benefit < minBenefitReq;
      const vs = computeValueScore(m, taskType, threshold, estimatedTokens, calibrationConfidence, guardrails);
      entry.rawConfidence = vs.rawConfidence;
      entry.effectiveConfidence = vs.effectiveConfidence;
      entry.minConfidenceToUseCalibration = guardrails.minConfidenceToUseCalibration;
      entry.minBenefitRequired = minBenefitReq;
      if (excludedByBenefit) {
        entry.excludedReason = "benefit_below_min";
      } else {
        entry.valueScoreEntry = {
          valueScore: vs.valueScore,
          benefit: vs.benefit,
          confidence: vs.effectiveConfidence,
        };
      }
    }
    return entry;
  });

  return { candidates };
}

/**
 * Stage 5.2: Selects attempt 1 model with escalation-aware cheap-first when enabled.
 * Returns { chosen, escalationAwareAudit }.
 */
function selectEscalationAwareAttempt1(
  workingModels: ModelSpec[],
  task: TaskCard,
  normalChoice: ModelSpec,
  estimatedTokens: { input: number; output: number },
  threshold: number,
  maxCost: number | undefined,
  escalationConfig: EscalationConfig | undefined,
  calibrationConfidence: Map<string, number> | undefined,
  premiumTaskTypes: TaskType[] = []
): { chosen: ModelSpec; escalationAwareAudit: EscalationAwareAudit } {
  const normalCost = computeExpectedCost(normalChoice, estimatedTokens);
  const normalQ = getExpertise(normalChoice, task.taskType);
  const normalConf = calibrationConfidence?.get(`${normalChoice.id}|${task.taskType}`) ?? 0.1;

  const audit: EscalationAwareAudit = {
    enabled: false,
    normalChoice: { modelId: normalChoice.id, expectedCostUSD: normalCost, Q: normalQ, conf: normalConf },
  };

  if (
    !escalationConfig ||
    escalationConfig.policy !== "promote_on_low_score" ||
    (escalationConfig.routingMode ?? "normal") !== "escalation_aware"
  ) {
    audit.reason = "escalation_aware_disabled";
    return { chosen: normalChoice, escalationAwareAudit: audit };
  }

  audit.enabled = true;

  if (premiumTaskTypes.includes(task.taskType)) {
    audit.premiumLane = true;
    audit.premiumLaneReason = `TaskType "${task.taskType}" is premium; cheap-first disabled.`;
    return { chosen: normalChoice, escalationAwareAudit: audit };
  }

  const cheapFirstOnlyWhenCanPromote = escalationConfig.cheapFirstOnlyWhenCanPromote ?? true;
  const taskTypeOverrides = escalationConfig.cheapFirstOverridesByTaskType?.[task.taskType];
  const cheapFirstMinConfidence = taskTypeOverrides?.minConfidence ?? escalationConfig.cheapFirstMinConfidence ?? 0.4;
  const cheapFirstSavingsMinPct = taskTypeOverrides?.savingsMinPct ?? escalationConfig.cheapFirstSavingsMinPct ?? 0.3;
  const cheapFirstSavingsMinUSD = escalationConfig.cheapFirstSavingsMinUSD;
  const cheapFirstBudgetHeadroomFactor = escalationConfig.cheapFirstBudgetHeadroomFactor ?? 1.1;
  const maxGapByDiff = { ...DEFAULT_CHEAP_FIRST_MAX_GAP, ...escalationConfig.cheapFirstMaxGapByDifficulty };
  const taskTypeGap = escalationConfig.cheapFirstMaxGapByTaskType?.[task.taskType]?.[task.difficulty];
  const maxGap = taskTypeGap ?? maxGapByDiff[task.difficulty] ?? 0.1;
  const availableModelIds = workingModels.map((m) => m.id);

  if (!calibrationConfidence || calibrationConfidence.size === 0) {
    audit.reason = "rejected: no_calibration_confidence";
    return { chosen: normalChoice, escalationAwareAudit: audit };
  }

  type Candidate = {
    m: ModelSpec;
    cost: number;
    Q: number;
    rawConf: number;
    promotionTargetId: string | null;
    promotionCost: number;
    gap: number;
    qualified: boolean;
    cheapFirstScore: number;
  };

  const maxCandidateCost = normalCost * (1 - cheapFirstSavingsMinPct);

  // Stage 6.3: Sequential gate filtering with primary blocker tracking
  const gateProgress: GateProgress = {
    initial: workingModels.length,
    afterSavings: 0,
    afterConfidence: 0,
    afterGap: 0,
    afterPromotion: 0,
    afterBudget: 0,
  };

  let candidates: Candidate[] = [];
  let primaryBlocker: PrimaryBlocker | null = null;

  // 1) savingsPct: cheaper than normal
  for (const m of workingModels) {
    const cost = computeExpectedCost(m, estimatedTokens);
    if (cost > maxCandidateCost) continue;
    if (cheapFirstSavingsMinUSD != null) {
      const savings = normalCost - cost;
      if (savings < cheapFirstSavingsMinUSD) continue;
    }
    const Q = getExpertise(m, task.taskType);
    const rawConf = calibrationConfidence.get(`${m.id}|${task.taskType}`) ?? 0.1;
    const qualified = Q >= threshold;
    const gap = threshold - Q;
    const { modelId: promotionTargetId } = selectEscalationModel({
      taskType: task.taskType,
      currentModelId: m.id,
      availableModelIds,
      orderByTaskType: escalationConfig.escalationModelOrderByTaskType,
    });
    const promotionModel = promotionTargetId ? workingModels.find((x) => x.id === promotionTargetId) : null;
    const promotionCost = promotionModel ? computeExpectedCost(promotionModel, estimatedTokens) : 0;
    const cheapFirstScore = (Q * rawConf) / (cost + 0.0001);
    candidates.push({
      m,
      cost,
      Q,
      rawConf,
      promotionTargetId: promotionTargetId ?? null,
      promotionCost,
      gap,
      qualified,
      cheapFirstScore,
    });
  }

  gateProgress.afterSavings = candidates.length;
  if (candidates.length === 0) {
    primaryBlocker = "no_cheap_first_candidates";
  }

  if (!primaryBlocker) {
    // 2) confidence
    candidates = candidates.filter((c) => c.rawConf >= cheapFirstMinConfidence);
    gateProgress.afterConfidence = candidates.length;
    if (candidates.length === 0) {
      primaryBlocker = "confidence";
    }
  }
  if (!primaryBlocker && candidates.length > 0) {
    // 3) gap
    candidates = candidates.filter((c) => {
      const nearThreshold = !c.qualified && c.gap <= maxGap && c.gap >= 0;
      return c.qualified || nearThreshold;
    });
    gateProgress.afterGap = candidates.length;
    if (candidates.length === 0) {
      primaryBlocker = "gap";
    }
  }
  if (!primaryBlocker && candidates.length > 0) {
    // 4) promotionTarget
    candidates = cheapFirstOnlyWhenCanPromote
      ? candidates.filter((c) => c.promotionTargetId != null)
      : candidates;
    gateProgress.afterPromotion = candidates.length;
    if (candidates.length === 0) {
      primaryBlocker = "noPromotionTarget";
    }
  }
  if (!primaryBlocker && candidates.length > 0) {
    // 5) budget
    candidates = candidates.filter((c) => {
      const worstCaseCost = c.cost + c.promotionCost;
      if (maxCost != null && worstCaseCost * cheapFirstBudgetHeadroomFactor > maxCost) return false;
      if (
        escalationConfig.maxExtraCostUSD != null &&
        c.promotionTargetId &&
        c.promotionCost > escalationConfig.maxExtraCostUSD
      )
        return false;
      return true;
    });
    gateProgress.afterBudget = candidates.length;
    if (candidates.length === 0) {
      primaryBlocker = "budget";
    }
  }

  const cheapCandidates = candidates;

  if (cheapCandidates.length === 0) {
    audit.reason = "rejected: no_cheap_first_candidates";
    audit.primaryBlocker = primaryBlocker ?? "no_cheap_first_candidates";
    if (escalationConfig.logPrimaryBlockerOnlyWhenFailed !== false) {
      audit.gateProgress = gateProgress;
    }
    const confByModel: Record<string, number> = {};
    for (const m of workingModels) {
      const rawConf = calibrationConfidence.get(`${m.id}|${task.taskType}`) ?? 0.1;
      confByModel[m.id] = rawConf;
    }
    audit.calibrationConfidenceByModel = confByModel;
    const counts: GateRejectionCounts = {
      savingsPct: gateProgress.initial - gateProgress.afterSavings,
      confidence: gateProgress.afterSavings - gateProgress.afterConfidence,
      gap: gateProgress.afterConfidence - gateProgress.afterGap,
      noPromotionTarget: gateProgress.afterGap - gateProgress.afterPromotion,
      budget: gateProgress.afterPromotion - gateProgress.afterBudget,
    };
    audit.gateRejectionCounts = counts;
    return { chosen: normalChoice, escalationAwareAudit: audit };
  }

  cheapCandidates.sort((a, b) => {
    if (b.cheapFirstScore !== a.cheapFirstScore) return b.cheapFirstScore - a.cheapFirstScore;
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (b.Q !== a.Q) return b.Q - a.Q;
    return b.rawConf - a.rawConf;
  });

  const cheapFirst = cheapCandidates[0];
  audit.cheapFirstChoice = {
    modelId: cheapFirst.m.id,
    expectedCostUSD: cheapFirst.cost,
    Q: cheapFirst.Q,
    conf: cheapFirst.rawConf,
    promotionTargetId: cheapFirst.promotionTargetId!,
    worstCaseExpectedCostUSD: cheapFirst.cost + cheapFirst.promotionCost,
  };
  audit.reason = "cheap_first_chosen";
  audit.savingsUSD = normalCost - cheapFirst.cost;
  audit.maxGap = maxGap;

  return { chosen: cheapFirst.m, escalationAwareAudit: audit };
}

/**
 * When candidateScores present, ranks models by score desc then predictedCostUSD asc.
 * When enforceCheapestViable (assertion), selects cheapest among passed; else selects best score.
 */
function selectWithModelHr(
  models: ModelSpec[],
  candidates: RoutingCandidateAuditEntry[],
  estimatedTokens: { input: number; output: number },
  routingOptions: RoutingOptions
): ModelSpec | null {
  const { candidateScores, cheapestViableChosen } = routingOptions;
  const enforceCheapestViable = cheapestViableChosen ?? false;
  const passed = candidates.filter((c) => c.passed);
  if (passed.length === 0) return null;

  if (enforceCheapestViable) {
    const minCost = Math.min(...passed.map((c) => c.predictedCostUSD));
    const cheapest = passed.find((c) => c.predictedCostUSD <= minCost * 1.0001);
    if (!cheapest) return null;
    return models.find((m) => m.id === cheapest.modelId) ?? null;
  }

  if (candidateScores && candidateScores.size > 0) {
    const passedIds = new Set(passed.map((c) => c.modelId));
    const withScores = models
      .filter((m) => candidateScores.has(m.id) && passedIds.has(m.id))
      .map((m) => ({ m, score: candidateScores.get(m.id)!, cost: computeExpectedCost(m, estimatedTokens) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.cost - b.cost;
      });
    const chosen = withScores[0];
    return chosen ? chosen.m : null;
  }

  return null;
}

/**
 * Selects an LLM model for a task.
 *
 * @param task - Task to route
 * @param models - Available models
 * @param config - Optional config; defaults match original behavior (thresholds 0.70/0.80/0.88, tokens 2000/1000)
 * @param routingOptions - Optional Model HR options: candidateScores, cheapestViableChosen (enforceCheapestViable assertion)
 *
 * Logic:
 * 1) Qualified = expertise >= threshold AND (if maxCostUSD) cost <= maxCostUSD
 * 2) When routingOptions.candidateScores: rank by score desc, cost asc
 * 3) When routingOptions.cheapestViableChosen (enforceCheapestViable): choose cheapest among passed (assertion mode)
 * 4) Else: choose cheapest among qualified; fallbacks = next N by same ordering
 * 5) If no qualified: behavior by config.onBudgetFail
 */
export function route(
  task: TaskCard,
  models: ModelSpec[],
  config?: Partial<RouterConfig>,
  directive?: string,
  portfolioOptions?: PortfolioRoutingOptions,
  routingOptions?: RoutingOptions
): RoutingDecisionWithAudit {
  if (!models.length) {
    throw new Error("No models provided to router");
  }

  const routingMeta: RoutingDecision["routingMeta"] = {};
  let workingModels = models;
  const hasAllowedFilter = (portfolioOptions?.allowedModelIds?.length ?? 0) > 0;

  if (hasAllowedFilter) {
    const allowed = models.filter((m) => portfolioOptions!.allowedModelIds!.includes(m.id));
    if (allowed.length === 0) {
      routingMeta.portfolioBypassed = true;
      routingMeta.reason = "no_allowed_models";
    } else {
      workingModels = allowed;
    }
  }

  const preferModelIds = portfolioOptions?.preferModelIds;
  const difficulty = task.difficulty;

  const cfg: RouterConfig = {
    ...DEFAULT_ROUTER_CONFIG,
    ...config,
    thresholds: { ...DEFAULT_ROUTER_CONFIG.thresholds, ...config?.thresholds },
    baseTokenEstimates: {
      input: {
        ...DEFAULT_ROUTER_CONFIG.baseTokenEstimates.input,
        ...config?.baseTokenEstimates?.input,
      },
      output: {
        ...DEFAULT_ROUTER_CONFIG.baseTokenEstimates.output,
        ...config?.baseTokenEstimates?.output,
      },
    },
    difficultyMultipliers: {
      ...DEFAULT_ROUTER_CONFIG.difficultyMultipliers,
      ...config?.difficultyMultipliers,
    },
    selectionPolicy: config?.selectionPolicy ?? DEFAULT_ROUTER_CONFIG.selectionPolicy ?? "lowest_cost_qualified",
    noQualifiedPolicy: config?.noQualifiedPolicy ?? DEFAULT_ROUTER_CONFIG.noQualifiedPolicy ?? "highest_expertise",
    nearThresholdDeltaByDifficulty: {
      ...DEFAULT_NEAR_THRESHOLD_DELTA,
      ...config?.nearThresholdDeltaByDifficulty,
    } as Record<Difficulty, number>,
    minConfidenceToUseCalibration: config?.minConfidenceToUseCalibration ?? DEFAULT_ROUTER_CONFIG.minConfidenceToUseCalibration,
    confidenceFloor: config?.confidenceFloor ?? DEFAULT_ROUTER_CONFIG.confidenceFloor,
    minBenefitByDifficulty: {
      ...DEFAULT_MIN_BENEFIT_BY_DIFFICULTY,
      ...config?.minBenefitByDifficulty,
    } as Record<Difficulty, number>,
    minBenefitNearThresholdByDifficulty: {
      ...DEFAULT_MIN_BENEFIT_NEAR_THRESHOLD_BY_DIFFICULTY,
      ...config?.minBenefitNearThresholdByDifficulty,
    } as Record<Difficulty, number>,
    premiumTaskTypes: config?.premiumTaskTypes ?? DEFAULT_ROUTER_CONFIG.premiumTaskTypes ?? [],
  };

  const estimatedTokens = computeEstimatedTokens(task, cfg, directive);
  const threshold = getThreshold(task, cfg);
  const priorsByModel = routingOptions?.priorsByModel;
  const qualified = filterQualified(
    task,
    workingModels,
    estimatedTokens,
    threshold,
    priorsByModel
  );
  const maxCost = task.constraints?.maxCostUSD;
  const n = cfg.fallbackCount;

  // --- Qualified models exist: choose by score (Model HR), best_value, or cheapest ---
  if (qualified.length > 0) {
    const bestValueGuardrails =
      cfg.selectionPolicy === "best_value" ? getBestValueGuardrails(cfg) : undefined;
    const routingAuditBase = buildRoutingAudit(
      models,
      task,
      task.taskType,
      estimatedTokens,
      threshold,
      qualified,
      workingModels,
      hasAllowedFilter,
      portfolioOptions?.allowedModelIds,
      routingOptions?.candidateScores,
      routingOptions?.candidateScoreBreakdowns,
      routingOptions?.priorsByModel,
      cfg.selectionPolicy,
      routingOptions?.calibrationConfidence,
      bestValueGuardrails
    );
    const { candidates } = routingAuditBase;

    let chosen: ModelSpec;
    let rankedBy: "score" | "cheapest_viable" | "best_value" | "escalation_aware" | undefined;
    let bestValueFallbackDueToMinBenefit = false;
    const enforceCheapestViable = routingOptions?.cheapestViableChosen ?? false;
    const useBestValue =
      cfg.selectionPolicy === "best_value" &&
      routingOptions?.calibrationConfidence &&
      routingOptions.calibrationConfidence.size > 0;

    if (useBestValue) {
      const bestValueResult = selectByBestValue(
        qualified,
        task.taskType,
        task.difficulty,
        threshold,
        estimatedTokens,
        routingOptions.calibrationConfidence!,
        bestValueGuardrails!
      );
      if (bestValueResult) {
        chosen = bestValueResult.model;
        rankedBy = "best_value";
      } else {
        const sorted = sortByExpertiseReliabilityCost(
          qualified,
          task.taskType,
          estimatedTokens,
          preferModelIds,
          difficulty
        );
        chosen = sorted[0];
        rankedBy = undefined;
        bestValueFallbackDueToMinBenefit = true;
      }
    } else if (routingOptions?.candidateScores && routingOptions.candidateScores.size > 0) {
      const modelHrChosen = selectWithModelHr(
        models,
        candidates,
        estimatedTokens,
        { candidateScores: routingOptions.candidateScores, cheapestViableChosen: enforceCheapestViable }
      );
      if (modelHrChosen) {
        chosen = modelHrChosen;
        rankedBy = enforceCheapestViable ? "cheapest_viable" : "score";
      } else {
        const sorted = sortByCostReliabilityExpertise(
          qualified,
          task.taskType,
          estimatedTokens,
          preferModelIds,
          difficulty
        );
        chosen = sorted[0];
      }
    } else if (enforceCheapestViable) {
      const passed = candidates.filter((c) => c.passed);
      const minCost = passed.length > 0 ? Math.min(...passed.map((c) => c.predictedCostUSD)) : Infinity;
      const cheapestPassed = passed.find((c) => c.predictedCostUSD <= minCost * 1.0001);
      const cheapestModel = cheapestPassed ? models.find((m) => m.id === cheapestPassed.modelId) : null;
      chosen = cheapestModel ?? sortByCostReliabilityExpertise(qualified, task.taskType, estimatedTokens, preferModelIds, difficulty)[0];
      rankedBy = "cheapest_viable";
    } else {
      const sorted = sortByCostReliabilityExpertise(
        qualified,
        task.taskType,
        estimatedTokens,
        preferModelIds,
        difficulty
      );
      chosen = sorted[0];
    }

    const escalationConfig = routingOptions?.escalationConfig;
    if (escalationConfig) {
      const { chosen: escalationAwareChosen, escalationAwareAudit } = selectEscalationAwareAttempt1(
        workingModels,
        task,
        chosen,
        estimatedTokens,
        threshold,
        maxCost ?? undefined,
        escalationConfig,
        routingOptions?.calibrationConfidence,
        cfg.premiumTaskTypes
      );
      chosen = escalationAwareChosen;
      if (escalationAwareAudit.cheapFirstChoice) {
        rankedBy = "escalation_aware";
      }
      (routingAuditBase as { escalationAware?: EscalationAwareAudit }).escalationAware = escalationAwareAudit;
    }

    const chosenCost = computeExpectedCost(chosen, estimatedTokens);
    const passedCandidates = candidates.filter((c) => c.passed);
    const minCostAmongPassed = passedCandidates.length > 0 ? Math.min(...passedCandidates.map((c) => c.predictedCostUSD)) : 0;
    const chosenIsCheapestViable =
      enforceCheapestViable &&
      passedCandidates.length > 0 &&
      Math.abs(chosenCost - minCostAmongPassed) <= 1e-9;

    const sortedForFallbacks =
      useBestValue && !bestValueFallbackDueToMinBenefit && routingOptions?.calibrationConfidence && bestValueGuardrails
        ? (() => {
            const eligible = qualified.filter((m) => {
              const Q = getExpertise(m, task.taskType);
              const benefit = Math.max(0, Q - threshold);
              return benefit >= (bestValueGuardrails!.minBenefitByDifficulty[task.difficulty] ?? 0);
            });
            if (eligible.length === 0) {
              return sortByExpertiseReliabilityCost(qualified, task.taskType, estimatedTokens, preferModelIds, difficulty);
            }
            return eligible
              .map((m) => {
                const vs = computeValueScore(m, task.taskType, threshold, estimatedTokens, routingOptions!.calibrationConfidence!, bestValueGuardrails!);
                return { m, valueScore: vs.valueScore, cost: computeExpectedCost(m, estimatedTokens), expertise: getExpertise(m, task.taskType) };
              })
              .sort((a, b) => {
                if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
                if (b.expertise !== a.expertise) return b.expertise - a.expertise;
                return a.cost - b.cost;
              })
              .map((x) => x.m);
          })()
        : routingOptions?.candidateScores && routingOptions.candidateScores.size > 0
          ? [...qualified]
              .filter((m) => routingOptions.candidateScores!.has(m.id))
              .map((m) => ({ m, score: routingOptions.candidateScores!.get(m.id)!, cost: computeExpectedCost(m, estimatedTokens) }))
              .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.cost - b.cost))
              .map((x) => x.m)
          : sortByCostReliabilityExpertise(qualified, task.taskType, estimatedTokens, preferModelIds, difficulty);
    const fallbacks = sortedForFallbacks
      .filter((m) => m.id !== chosen.id)
      .slice(0, n)
      .map((m) => m.id);

    const routingAudit = {
      ...routingAuditBase,
      enforceCheapestViable,
      chosenIsCheapestViable,
      rankedBy,
    };

    const chosenCandidate = candidates.find((c) => c.modelId === chosen.id);
    const valueScoreEntry = chosenCandidate?.valueScoreEntry;
    const escalationAware = (routingAuditBase as { escalationAware?: EscalationAwareAudit }).escalationAware;
    let rationale: string;
    if (escalationAware?.cheapFirstChoice) {
      rationale = `Escalation-aware routing: normal choice ${escalationAware.normalChoice.modelId} ($${escalationAware.normalChoice.expectedCostUSD.toFixed(4)}); cheap-first ${escalationAware.cheapFirstChoice.modelId} ($${escalationAware.cheapFirstChoice.expectedCostUSD.toFixed(4)}), savings=$${(escalationAware.savingsUSD ?? 0).toFixed(4)}, promotion target=${escalationAware.cheapFirstChoice.promotionTargetId}, worst-case=$${escalationAware.cheapFirstChoice.worstCaseExpectedCostUSD.toFixed(4)}.`;
    } else if (escalationAware?.enabled && escalationAware.reason && !escalationAware.cheapFirstChoice) {
      rationale = `Escalation-aware routing enabled; ${escalationAware.reason}. Using normal choice ${escalationAware.normalChoice.modelId} ($${escalationAware.normalChoice.expectedCostUSD.toFixed(4)}).`;
    } else if (bestValueFallbackDueToMinBenefit) {
      rationale = `Qualified. All best_value candidates excluded by minBenefit rules. Fallback to highest expertise (${getExpertise(chosen, task.taskType).toFixed(2)}), cost=$${chosenCost.toFixed(4)}.`;
    } else if (rankedBy === "best_value" && valueScoreEntry) {
      const confNote =
        chosenCandidate?.rawConfidence != null &&
        chosenCandidate?.minConfidenceToUseCalibration != null &&
        chosenCandidate.rawConfidence < chosenCandidate.minConfidenceToUseCalibration
          ? ` (confidence floored from ${chosenCandidate.rawConfidence.toFixed(2)} to ${chosenCandidate.effectiveConfidence?.toFixed(2) ?? valueScoreEntry.confidence.toFixed(2)})`
          : "";
      rationale = `Qualified. Chosen by best_value: valueScore=${valueScoreEntry.valueScore.toFixed(2)}, benefit=${valueScoreEntry.benefit.toFixed(3)}, conf=${valueScoreEntry.confidence.toFixed(2)}, cost=$${chosenCost.toFixed(4)}.${confNote}`;
    } else if (rankedBy) {
      rationale = `Qualified. Chosen by ${rankedBy} ($${chosenCost.toFixed(4)}).`;
    } else {
      rationale = `Qualified (expertise ${getExpertise(chosen, task.taskType).toFixed(2)} >= ${threshold}). Chosen by lowest cost ($${chosenCost.toFixed(4)}), then reliability (${chosen.reliability}), expertise.`;
    }

    return {
      chosenModelId: chosen.id,
      fallbackModelIds: fallbacks,
      expectedCostUSD: chosenCost,
      estimatedTokens,
      status: "ok",
      rationale,
      routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
      routingAudit,
    };
  }

  // --- No qualified models: apply onBudgetFail policy ---
  if (hasAllowedFilter && qualified.length === 0 && workingModels.length > 0) {
    const allOverBudget =
      maxCost != null &&
      workingModels.every((m) => computeExpectedCost(m, estimatedTokens) > maxCost);
    const allBelowQuality = workingModels.every(
      (m) => getEffectiveQuality(m, task.taskType, task.difficulty, priorsByModel) < threshold
    );
    if (allOverBudget) {
      routingMeta.portfolioBypassed = true;
      routingMeta.reason = "allowed_models_over_budget";
    } else if (allBelowQuality) {
      routingMeta.portfolioBypassed = true;
      routingMeta.reason = "allowed_models_below_quality";
    }
  }

  const routingAuditNoQualified = buildRoutingAudit(
    models,
    task,
    task.taskType,
    estimatedTokens,
    threshold,
    qualified,
    workingModels,
    hasAllowedFilter,
    portfolioOptions?.allowedModelIds,
    routingOptions?.candidateScores,
    routingOptions?.candidateScoreBreakdowns,
    routingOptions?.priorsByModel
  );

  switch (cfg.onBudgetFail) {
    case "fail":
      return {
        chosenModelId: null,
        fallbackModelIds: [],
        expectedCostUSD: null,
        estimatedTokens,
        status: "no_qualified_models",
        rationale: `No models met threshold ${threshold}${maxCost != null ? ` or budget $${maxCost}` : ""}. Policy: fail.`,
        routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
        routingAudit: routingAuditNoQualified,
      };

    case "best_effort_within_budget":
      if (maxCost != null) {
        const withinBudget = filterWithinBudget(
          workingModels,
          maxCost,
          estimatedTokens
        );
        if (withinBudget.length === 0) {
          if (hasAllowedFilter && workingModels.length > 0) {
            routingMeta.portfolioBypassed = true;
            routingMeta.reason = "allowed_models_over_budget";
          }
          return {
            chosenModelId: null,
            fallbackModelIds: [],
            expectedCostUSD: null,
            estimatedTokens,
            status: "no_qualified_models",
            rationale: `No models met threshold ${threshold} or budget $${maxCost}. No models within budget.`,
            routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
            routingAudit: routingAuditNoQualified,
          };
        }
        const sorted = sortByExpertiseReliabilityCost(
          withinBudget,
          task.taskType,
          estimatedTokens,
          preferModelIds,
          difficulty
        );
        const chosen = sorted[0];
        const chosenCost = computeExpectedCost(chosen, estimatedTokens);
        const fallbacks = sorted
          .filter((m) => m.id !== chosen.id)
          .slice(0, n)
          .map((m) => m.id);
        return {
          chosenModelId: chosen.id,
          fallbackModelIds: fallbacks,
          expectedCostUSD: chosenCost,
          estimatedTokens,
          status: "ok",
          rationale: `No models met threshold ${threshold}. Best effort within budget: highest expertise (${getExpertise(chosen, task.taskType).toFixed(2)}) for "${task.taskType}".`,
          routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
          routingAudit: routingAuditNoQualified,
        };
      }
      // maxCost not set: choose highest expertise (current behavior)
      break;

    case "ignore_budget":
      // Choose highest expertise, ignore budget
      break;
  }

  // best_effort_within_budget (no maxCost) or ignore_budget: highest expertise
  // When selectionPolicy is best_value and noQualifiedPolicy is best_value_near_threshold, use cost-aware near-threshold fallback
  const useNearThreshold =
    cfg.selectionPolicy === "best_value" &&
    cfg.noQualifiedPolicy === "best_value_near_threshold" &&
    routingOptions?.calibrationConfidence &&
    routingOptions.calibrationConfidence.size > 0;

  let nearThresholdFallbackDueToMinBenefit = false;
  if (useNearThreshold) {
    const delta =
      (cfg.nearThresholdDeltaByDifficulty ?? DEFAULT_NEAR_THRESHOLD_DELTA)[task.difficulty] ??
      DEFAULT_NEAR_THRESHOLD_DELTA.high;
    const effectiveThreshold = threshold - delta;
    let nearModels = workingModels.filter(
      (m) => getEffectiveQuality(m, task.taskType, task.difficulty, priorsByModel) >= effectiveThreshold
    );
    if (maxCost != null) {
      nearModels = filterWithinBudget(nearModels, maxCost, estimatedTokens);
    }
    if (nearModels.length > 0) {
      const guardrails = getBestValueGuardrails(cfg);
      const nearResult = selectByBestValueNearThreshold(
        nearModels,
        task.taskType,
        task.difficulty,
        threshold,
        delta,
        estimatedTokens,
        routingOptions.calibrationConfidence!,
        guardrails
      );
      if (nearResult) {
        const { model: chosen, valueScoreEntry } = nearResult;
        nearThresholdFallbackDueToMinBenefit = false;
        const chosenCost = computeExpectedCost(chosen, estimatedTokens);
        const minBenefitNear = guardrails.minBenefitNearThresholdByDifficulty[task.difficulty] ?? 0;
        const eligibleNear = nearModels.filter((m) => {
          const Q = getExpertise(m, task.taskType);
          const benefitNear = Math.max(0, Q - effectiveThreshold);
          return benefitNear >= minBenefitNear;
        });
        const sortedNear = eligibleNear.length > 0
          ? eligibleNear
              .map((m) => ({
                m,
                vs: computeValueScore(m, task.taskType, effectiveThreshold, estimatedTokens, routingOptions.calibrationConfidence!, guardrails),
              }))
              .sort((a, b) => {
                if (b.vs.valueScore !== a.vs.valueScore) return b.vs.valueScore - a.vs.valueScore;
                if (getExpertise(b.m, task.taskType) !== getExpertise(a.m, task.taskType))
                  return getExpertise(b.m, task.taskType) - getExpertise(a.m, task.taskType);
                return computeExpectedCost(a.m, estimatedTokens) - computeExpectedCost(b.m, estimatedTokens);
              })
          : nearModels.map((m) => ({ m, vs: { valueScore: 0, benefit: 0, rawConfidence: 0, effectiveConfidence: 0 } }));
        const fallbacks = sortedNear
          .filter((x) => x.m.id !== chosen.id)
          .slice(0, n)
          .map((x) => x.m.id);

        const auditWithValueScore = {
          ...routingAuditNoQualified,
          noQualifiedBestValueEntry: valueScoreEntry,
          rankedBy: "best_value_near_threshold" as const,
        };

        const confNote =
          nearResult.rawConfidence != null &&
          nearResult.minConfidenceToUseCalibration != null &&
          nearResult.rawConfidence < nearResult.minConfidenceToUseCalibration
            ? ` (confidence floored from ${nearResult.rawConfidence.toFixed(2)} to ${nearResult.effectiveConfidence?.toFixed(2) ?? valueScoreEntry.confidence.toFixed(2)})`
            : "";
        return {
          chosenModelId: chosen.id,
          fallbackModelIds: fallbacks,
          expectedCostUSD: chosenCost,
          estimatedTokens,
          status: "ok",
          rationale: `No qualified models; using best_value_near_threshold delta=${delta}: valueScore=${valueScoreEntry.valueScore.toFixed(2)}, benefit=${valueScoreEntry.benefit.toFixed(3)}, conf=${valueScoreEntry.confidence.toFixed(2)}, cost=$${chosenCost.toFixed(4)}.${confNote}`,
          routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
          routingAudit: auditWithValueScore,
        };
      }
      nearThresholdFallbackDueToMinBenefit = true;
      // All near-threshold candidates excluded by minBenefitNear; fall through to highest-expertise
    }
  }

  const sorted = sortByExpertiseReliabilityCost(
    workingModels,
    task.taskType,
    estimatedTokens,
    preferModelIds,
    difficulty
  );
  const chosen = sorted[0];
  const chosenCost = computeExpectedCost(chosen, estimatedTokens);
  const fallbacks = sorted
    .filter((m) => m.id !== chosen.id)
    .slice(0, n)
    .map((m) => m.id);

  const rationale = nearThresholdFallbackDueToMinBenefit
    ? `No qualified models; all best_value_near_threshold candidates excluded by minBenefitNear. Fallback to highest expertise (${getExpertise(chosen, task.taskType).toFixed(2)}) for task type "${task.taskType}".`
    : `No models met threshold ${threshold}. Fallback to highest expertise (${getExpertise(chosen, task.taskType).toFixed(2)}) for task type "${task.taskType}".`;

  return {
    chosenModelId: chosen.id,
    fallbackModelIds: fallbacks,
    expectedCostUSD: chosenCost,
    estimatedTokens,
    status: "ok",
    rationale,
    routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
    routingAudit: routingAuditNoQualified,
  };
}

/** Stage 5.3: Normal choice (what would be chosen without escalation-aware). No extra LLM calls. */
export interface ComputeNormalChoiceResult {
  modelId: string;
  expectedCostUSD: number;
  threshold: number;
  expertise: number;
  rawConfidence?: number;
  rationale?: string;
}

export function computeNormalChoice(
  task: TaskCard,
  models: ModelSpec[],
  config: Partial<RouterConfig>,
  directive: string | undefined,
  routingOptions: RoutingOptions | undefined
): ComputeNormalChoiceResult | null {
  const optionsNormal: RoutingOptions = {
    ...routingOptions,
    escalationConfig: routingOptions?.escalationConfig
      ? { ...routingOptions.escalationConfig, routingMode: "normal" }
      : { policy: "off", maxPromotions: 1, minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 }, routingMode: "normal" },
  };
  const routing = route(task, models, config, directive, undefined, optionsNormal);
  if (routing.status !== "ok" || routing.chosenModelId === null) return null;
  const model = models.find((m) => m.id === routing.chosenModelId!);
  if (!model) return null;
  const threshold = getThresholdForTask(task, config);
  const expertise = getExpertise(model, task.taskType);
  const rawConfidence = routingOptions?.calibrationConfidence?.get(`${routing.chosenModelId}|${task.taskType}`);
  return {
    modelId: routing.chosenModelId,
    expectedCostUSD: routing.expectedCostUSD ?? 0,
    threshold,
    expertise,
    rawConfidence,
    rationale: routing.rationale,
  };
}
