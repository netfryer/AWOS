/**
 * Normalization layer for provider model entries.
 * Canonical id format: "<provider>/<modelId>"
 * identity.modelId = raw provider modelId
 * Aliases preserved if present.
 */

import type { ModelRegistryEntry } from "../types.js";

export interface ProviderModelInput {
  modelId: string;
  displayName: string;
  pricing: {
    inPer1k: number;
    outPer1k: number;
    currency?: string;
    minimumChargeUSD?: number;
    roundingRule?: "perToken" | "per1k" | "perRequest";
  };
  allowedTiers?: ("cheap" | "standard" | "premium")[];
  expertise?: Record<string, number>;
  reliability?: number;
  aliases?: string[];
}

/** Build canonical id: "<provider>/<modelId>" */
export function toCanonicalId(provider: string, modelId: string): string {
  const safeProvider = provider.trim().toLowerCase();
  const safeModelId = modelId.trim();
  if (!safeProvider || !safeModelId) {
    throw new Error("Provider and modelId are required");
  }
  return `${safeProvider}/${safeModelId}`;
}

/** Default expertise when not provided */
const DEFAULT_EXPERTISE: Record<string, number> = {
  general: 0.7,
  code: 0.7,
  writing: 0.7,
  analysis: 0.7,
};

/** Normalize and validate provider model input into a ModelRegistryEntry. */
export function normalizeProviderModel(
  provider: string,
  input: ProviderModelInput,
  existing: ModelRegistryEntry | null
): ModelRegistryEntry {
  const canonicalId = toCanonicalId(provider, input.modelId);
  const now = new Date().toISOString();

  const entry: ModelRegistryEntry = {
    id: canonicalId,
    identity: {
      provider: provider.trim(),
      modelId: input.modelId.trim(),
      status: existing ? existing.identity.status : "probation",
      aliases: input.aliases?.length ? [...input.aliases] : existing?.identity.aliases,
      ...(existing?.identity.disabledAtISO && { disabledAtISO: existing.identity.disabledAtISO }),
      ...(existing?.identity.disabledReason && { disabledReason: existing.identity.disabledReason }),
    },
    displayName: input.displayName.trim() || input.modelId.trim(),
    pricing: {
      inPer1k: input.pricing.inPer1k,
      outPer1k: input.pricing.outPer1k,
      currency: input.pricing.currency ?? "USD",
      ...(input.pricing.minimumChargeUSD != null && { minimumChargeUSD: input.pricing.minimumChargeUSD }),
      ...(input.pricing.roundingRule != null && { roundingRule: input.pricing.roundingRule }),
    },
    expertise: input.expertise ?? existing?.expertise ?? DEFAULT_EXPERTISE,
    reliability: input.reliability ?? existing?.reliability ?? 0.7,
    governance: input.allowedTiers?.length
      ? { allowedTiers: input.allowedTiers }
      : existing?.governance,
    performancePriors: existing?.performancePriors ?? [],
    evaluationMeta: existing ? existing.evaluationMeta : { canaryStatus: "none" },
    capabilities: existing?.capabilities,
    guardrails: existing?.guardrails,
    operational: existing?.operational,
    createdAtISO: existing?.createdAtISO ?? now,
    updatedAtISO: now,
  };

  return entry;
}
