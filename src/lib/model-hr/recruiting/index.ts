/**
 * Recruiting module: safe model onboarding.
 */

export {
  processProviderModel,
  processProviderModels,
  type RecruitingReport,
  type RecruitingReportItem,
  type RecruitingReportAction,
  type ProcessProviderModelOptions,
} from "./recruitingService.js";

export { toCanonicalId, normalizeProviderModel, type ProviderModelInput } from "./normalization.js";

export { diffProviderModel, type ModelDiff, type ChangeKind } from "./diff.js";
