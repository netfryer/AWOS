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
} from "./types.js";

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

/** Candidate audit entry for provable cheapest-viable selection */
export interface RoutingCandidateAuditEntry {
  modelId: string;
  predictedCostUSD: number;
  predictedQuality: number;
  passed: boolean;
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

/** Optional routing options for Model HR ranking and cheapest-viable assertion */
export interface RoutingOptions {
  /** Pre-computed scores by modelId (from ScoreService.computeModelScore) */
  candidateScores?: Map<string, number>;
  /** Score breakdowns by modelId when Model HR scoring is used */
  candidateScoreBreakdowns?: Map<string, ModelScoreBreakdown>;
  /** When true, enforce cheapest among passed (assertion mode); else choose best score. External API: cheapestViableChosen */
  cheapestViableChosen?: boolean;
}

/** RoutingDecision with optional audit (extends base without changing API) */
type RoutingDecisionWithAudit = RoutingDecision & {
  routingAudit?: {
    candidates: RoutingCandidateAuditEntry[];
    enforceCheapestViable?: boolean;
    chosenIsCheapestViable?: boolean;
    rankedBy?: "score" | "cheapest_viable";
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
};

/**
 * Directive-based token estimation (lower, more realistic).
 * Uses directive length when present; falls back to baseTokenEstimates otherwise.
 */
export function estimateTokensForTask(
  task: TaskCard,
  directive?: string,
  config?: Partial<RouterConfig>
): { input: number; output: number } {
  const cfg = config ?? DEFAULT_ROUTER_CONFIG;
  const mult = cfg.difficultyMultipliers?.[task.difficulty] ?? 1;

  if (directive != null && String(directive).trim().length > 0) {
    const len = String(directive).trim().length;
    const rawInput = Math.round(len / 4);
    const rawOutput = Math.round(rawInput * 0.6);
    const input = Math.max(200, Math.min(6000, rawInput));
    const output = Math.max(100, Math.min(2500, rawOutput));
    return {
      input: Math.round(input * mult),
      output: Math.round(output * mult),
    };
  }

  const baseInput =
    cfg.baseTokenEstimates?.input?.[task.taskType] ?? DEFAULT_INPUT_TOKENS;
  const baseOutput =
    cfg.baseTokenEstimates?.output?.[task.taskType] ?? DEFAULT_OUTPUT_TOKENS;
  return {
    input: Math.round(baseInput * mult),
    output: Math.round(baseOutput * mult),
  };
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
 * Filters models that meet: expertise >= threshold AND (if maxCostUSD) cost <= maxCostUSD.
 */
function filterQualified(
  task: TaskCard,
  models: ModelSpec[],
  estimatedTokens: { input: number; output: number },
  threshold: number
): ModelSpec[] {
  const maxCost = task.constraints?.maxCostUSD;
  return models.filter((m) => {
    const expertise = getExpertise(m, task.taskType);
    if (expertise < threshold) return false;
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
  candidateScoreBreakdowns?: Map<string, ModelScoreBreakdown>
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
    const predictedQuality = getExpertise(m, taskType);
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
    return entry;
  });

  return { candidates };
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
  };

  const estimatedTokens = computeEstimatedTokens(task, cfg, directive);
  const threshold = getThreshold(task, cfg);
  const qualified = filterQualified(
    task,
    workingModels,
    estimatedTokens,
    threshold
  );
  const maxCost = task.constraints?.maxCostUSD;
  const n = cfg.fallbackCount;

  // --- Qualified models exist: choose by score (Model HR) or cheapest ---
  if (qualified.length > 0) {
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
      routingOptions?.candidateScoreBreakdowns
    );
    const { candidates } = routingAuditBase;

    let chosen: ModelSpec;
    let rankedBy: "score" | "cheapest_viable" | undefined;
    const enforceCheapestViable = routingOptions?.cheapestViableChosen ?? false;

    if (routingOptions?.candidateScores && routingOptions.candidateScores.size > 0) {
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

    const chosenCost = computeExpectedCost(chosen, estimatedTokens);
    const passedCandidates = candidates.filter((c) => c.passed);
    const minCostAmongPassed = passedCandidates.length > 0 ? Math.min(...passedCandidates.map((c) => c.predictedCostUSD)) : 0;
    const chosenIsCheapestViable =
      enforceCheapestViable &&
      passedCandidates.length > 0 &&
      Math.abs(chosenCost - minCostAmongPassed) <= 1e-9;

    const sortedForFallbacks =
      routingOptions?.candidateScores && routingOptions.candidateScores.size > 0
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

    return {
      chosenModelId: chosen.id,
      fallbackModelIds: fallbacks,
      expectedCostUSD: chosenCost,
      estimatedTokens,
      status: "ok",
      rationale: rankedBy
        ? `Qualified. Chosen by ${rankedBy} ($${chosenCost.toFixed(4)}).`
        : `Qualified (expertise ${getExpertise(chosen, task.taskType).toFixed(2)} >= ${threshold}). Chosen by lowest cost ($${chosenCost.toFixed(4)}), then reliability (${chosen.reliability}), expertise.`,
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
      (m) => getExpertise(m, task.taskType) < threshold
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
    routingOptions?.candidateScoreBreakdowns
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

  return {
    chosenModelId: chosen.id,
    fallbackModelIds: fallbacks,
    expectedCostUSD: chosenCost,
    estimatedTokens,
    status: "ok",
    rationale: `No models met threshold ${threshold}. Fallback to highest expertise (${getExpertise(chosen, task.taskType).toFixed(2)}) for task type "${task.taskType}".`,
    routingMeta: Object.keys(routingMeta).length > 0 ? routingMeta : undefined,
    routingAudit: routingAuditNoQualified,
  };
}
