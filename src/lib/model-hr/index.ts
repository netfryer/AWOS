/**
 * Model HR: canonical model registry, policy, and evaluation.
 */

export type {
  ModelStatus,
  ModelIdentity,
  ModelPricing,
  ModelCapabilities,
  ModelGuardrails,
  ModelOperational,
  ModelPerformancePrior,
  ModelGovernance,
  ModelEvaluationMeta,
  ModelRegistryEntry,
  ModelObservation,
  QaMode,
  ListModelsFilters,
  ModelScoreContext,
  ModelScoreBreakdown,
  CanaryThresholds,
} from "./types.js";

export {
  makeFileRegistryService,
  listModels,
  getModel,
  upsertModel,
  disableModel,
  setModelStatus,
  loadPriorsForModel,
  loadObservationsForModel,
  RegistryService,
  FileStorageAdapter,
} from "./registry/index.js";

export {
  makePolicyService,
  listEligibleModels,
  PolicyService,
} from "./policy/index.js";

export {
  makeEvaluationService,
  recordObservation,
  updatePriorsForObservation,
  EvaluationService,
} from "./evaluation/index.js";

export {
  makeScoreService,
  computeModelScore,
  computeModelScoreWithBreakdown,
  getPrior,
  ScoreService,
} from "./scoring/index.js";

export type {
  DisqualificationReason,
  EligibilityContext,
  EligibilityResult,
} from "./policy/policyService.js";

export { mapRegistryEntryToModelSpec } from "./adapters.js";

export {
  processProviderModel,
  processProviderModels,
  toCanonicalId,
  diffProviderModel,
  type RecruitingReport,
  type RecruitingReportItem,
  type ProviderModelInput,
  type ModelDiff,
  type ChangeKind,
} from "./recruiting/index.js";

export {
  computePricingExpectedCostUSD,
  detectPricingMismatch,
  PRICING_MISMATCH_THRESHOLD,
} from "./pricing.js";
export type { EstimatedTokens, PricingSpec, PricingMismatchResult } from "./pricing.js";

export {
  computePredictedCostUSD,
  type CompResult,
  type CompContext,
  type CompInputsBreakdown,
} from "./comp/index.js";

export { recordRegistryFallback, getRegistryFallbackCountLastHours } from "./registryHealth.js";

export {
  enqueueAction,
  listActions,
  getActionById,
  approveAction,
  rejectAction,
  type HrAction,
  type HrActionType,
  type HrActionRecommendedBy,
} from "./actions/index.js";
export { getModelRegistryForRuntime } from "./runtimeRegistry.js";
export type { GetModelRegistryResult } from "./runtimeRegistry.js";

export { emitModelHrSignal, emitEscalationSignal, readModelHrSignals, readModelHrSignalsForModel } from "./signals/index.js";
export type { ModelHrSignal } from "./signals/index.js";

export type {
  CanaryTask,
  CanaryRunResult,
  CanarySuiteResult,
  CanaryPolicyResult,
} from "./canary/index.js";
export { runCanary, evaluateSuiteForStatusChange, DEFAULT_CANARY_SUITE } from "./canary/index.js";

export type { StorageAdapter } from "./registry/storage/types.js";

export { buildModelHrAnalytics } from "./analytics/index.js";
export type { ModelHrAnalytics } from "./analytics/index.js";
