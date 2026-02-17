/**
 * Diff layer: detect changes between provider input and existing registry entry.
 * - new: no existing model
 * - pricing_changed: inPer1k or outPer1k changed
 * - metadata_changed: displayName, expertise, reliability, governance, capabilities, guardrails
 */

import type { ModelRegistryEntry } from "../types.js";
import type { ProviderModelInput } from "./normalization.js";

export type ChangeKind = "new" | "pricing_changed" | "metadata_changed" | "unchanged";

export interface ModelDiff {
  kind: ChangeKind;
  pricingChanged: boolean;
  metadataChanged: boolean;
}

function pricingEqual(
  a: { inPer1k: number; outPer1k: number },
  b: { inPer1k: number; outPer1k: number }
): boolean {
  return a.inPer1k === b.inPer1k && a.outPer1k === b.outPer1k;
}

function governanceEqual(
  a: { allowedTiers?: string[] } | undefined,
  b: { allowedTiers?: string[] } | undefined
): boolean {
  const aTiers = a?.allowedTiers ?? [];
  const bTiers = b?.allowedTiers ?? [];
  if (aTiers.length !== bTiers.length) return false;
  return aTiers.every((t, i) => t === bTiers[i]);
}

function expertiseEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): boolean {
  const aKeys = Object.keys(a ?? {}).sort();
  const bKeys = Object.keys(b ?? {}).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (aKeys.join() !== bKeys.join()) return false;
  return aKeys.every((k) => (a ?? {})[k] === (b ?? {})[k]);
}

/** Detect what changed between provider input and existing entry. */
export function diffProviderModel(
  provider: string,
  input: ProviderModelInput,
  existing: ModelRegistryEntry | null
): ModelDiff {
  if (!existing) {
    return { kind: "new", pricingChanged: false, metadataChanged: false };
  }

  const pricingChanged = !pricingEqual(input.pricing, existing.pricing);
  const metadataChanged =
    (input.displayName?.trim() || input.modelId) !== (existing.displayName ?? existing.identity.modelId) ||
    (input.reliability != null && input.reliability !== existing.reliability) ||
    !expertiseEqual(input.expertise, existing.expertise) ||
    !governanceEqual(
      input.allowedTiers ? { allowedTiers: input.allowedTiers } : undefined,
      existing.governance
    );

  if (pricingChanged && metadataChanged) {
    return { kind: "metadata_changed", pricingChanged: true, metadataChanged: true };
  }
  if (pricingChanged) {
    return { kind: "pricing_changed", pricingChanged: true, metadataChanged: false };
  }
  if (metadataChanged) {
    return { kind: "metadata_changed", pricingChanged: false, metadataChanged: true };
  }

  return { kind: "unchanged", pricingChanged: false, metadataChanged: false };
}
