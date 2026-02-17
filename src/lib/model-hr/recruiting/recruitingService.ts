/**
 * RecruitingService: safe, consistent model onboarding.
 * - Validates and normalizes provider model entries
 * - Detects new vs pricing_changed vs metadata_changed
 * - Enforces onboarding flow: new -> probation + canary required
 * - Refuses dangerous updates unless override
 * - Emits MODEL_HR_SIGNAL for changes
 */

import type { ModelRegistryEntry } from "../types.js";
import { normalizeProviderModel, toCanonicalId, type ProviderModelInput } from "./normalization.js";
import { diffProviderModel, type ModelDiff } from "./diff.js";
import { getModel, upsertModel, upsertModelReplacing } from "../registry/index.js";
import type { RegistryService } from "../registry/registryService.js";
import { emitModelHrSignal } from "../signals/signalLog.js";

type RegistryLike = Pick<RegistryService, "getModel" | "upsertModel" | "upsertModelReplacing">;

export type RecruitingReportAction = "created" | "updated" | "skipped";

export interface RecruitingReportItem {
  modelId: string;
  canonicalId: string;
  action: RecruitingReportAction;
  reason: string;
  diff?: ModelDiff;
}

export interface RecruitingReport {
  created: RecruitingReportItem[];
  updated: RecruitingReportItem[];
  skipped: RecruitingReportItem[];
}

export interface ProcessProviderModelOptions {
  /** When true, allow setting status=active for a brand new model (dangerous) */
  forceActiveOverride?: boolean;
}

/**
 * Find existing model by canonical id or by raw modelId (for backward compat).
 */
async function findExisting(
  provider: string,
  rawModelId: string,
  registry: RegistryLike
): Promise<ModelRegistryEntry | null> {
  const canonicalId = toCanonicalId(provider, rawModelId);
  const byCanonical = await registry.getModel(canonicalId);
  if (byCanonical) return byCanonical;
  const byRaw = await registry.getModel(rawModelId);
  if (byRaw && byRaw.identity.provider === provider) return byRaw;
  return null;
}

/** Default registry: uses singleton from registry index */
const defaultRegistry: RegistryLike = {
  getModel,
  upsertModel,
  upsertModelReplacing,
};

/**
 * Process a single provider model: validate, diff, apply with safety checks.
 * @param registry Optional - for tests; uses default singleton when omitted
 */
export async function processProviderModel(
  provider: string,
  input: ProviderModelInput,
  options: ProcessProviderModelOptions = {},
  registry: RegistryLike = defaultRegistry
): Promise<RecruitingReportItem> {
  const { forceActiveOverride = false } = options;
  const canonicalId = toCanonicalId(provider, input.modelId);
  const existing = await findExisting(provider, input.modelId, registry);
  const diff = diffProviderModel(provider, input, existing);

  if (diff.kind === "unchanged") {
    return {
      modelId: input.modelId,
      canonicalId,
      action: "skipped",
      reason: "unchanged",
      diff,
    };
  }

  if (diff.kind === "new") {
    const entry = normalizeProviderModel(provider, input, null);
    if (!forceActiveOverride) {
      entry.identity.status = "probation";
      entry.evaluationMeta = { canaryStatus: "none" };
    } else {
      entry.identity.status = "active";
    }
    await registry.upsertModel(entry);
    emitModelHrSignal({
      modelId: canonicalId,
      previousStatus: "none",
      newStatus: entry.identity.status,
      reason: forceActiveOverride ? "status_forced_override" : "model_created",
      sampleCount: 0,
    });
    return {
      modelId: input.modelId,
      canonicalId,
      action: "created",
      reason: forceActiveOverride ? "status_forced_override" : "model_created",
      diff,
    };
  }

  if (diff.kind === "pricing_changed") {
    const entry = normalizeProviderModel(provider, input, existing);
    const needsMigration = existing!.id !== canonicalId;
    await (needsMigration ? registry.upsertModelReplacing(entry, existing!.id) : registry.upsertModel(entry));
    emitModelHrSignal({
      modelId: canonicalId,
      previousStatus: existing!.identity.status,
      newStatus: existing!.identity.status,
      reason: "pricing_changed",
      sampleCount: 0,
    });
    return {
      modelId: input.modelId,
      canonicalId,
      action: "updated",
      reason: "pricing_changed",
      diff,
    };
  }

  if (diff.kind === "metadata_changed") {
    const entry = normalizeProviderModel(provider, input, existing);
    const needsMigration = existing!.id !== canonicalId;
    await (needsMigration ? registry.upsertModelReplacing(entry, existing!.id) : registry.upsertModel(entry));
    const reasons: string[] = [];
    if (diff.pricingChanged) reasons.push("pricing_changed");
    if (diff.metadataChanged) reasons.push("metadata_changed");
    emitModelHrSignal({
      modelId: canonicalId,
      previousStatus: existing!.identity.status,
      newStatus: existing!.identity.status,
      reason: reasons.length > 0 ? reasons.join("+") : "metadata_changed",
      sampleCount: 0,
    });
    return {
      modelId: input.modelId,
      canonicalId,
      action: "updated",
      reason: "metadata_changed",
      diff,
    };
  }

  return {
    modelId: input.modelId,
    canonicalId,
    action: "skipped",
    reason: "unchanged",
    diff,
  };
}

/**
 * Process multiple provider models and return a recruiting report.
 * @param registry Optional - for tests; uses default singleton when omitted
 */
export async function processProviderModels(
  provider: string,
  inputs: ProviderModelInput[],
  options: ProcessProviderModelOptions = {},
  registry: RegistryLike = defaultRegistry
): Promise<RecruitingReport> {
  const report: RecruitingReport = { created: [], updated: [], skipped: [] };

  for (const input of inputs) {
    try {
      const item = await processProviderModel(provider, input, options, registry);
      if (item.action === "created") report.created.push(item);
      else if (item.action === "updated") report.updated.push(item);
      else report.skipped.push(item);
    } catch (e) {
      throw new Error(
        `Recruiting failed for ${provider}/${input.modelId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return report;
}
