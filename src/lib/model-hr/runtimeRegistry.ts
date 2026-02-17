/**
 * Runtime model registry loader: registry-first with minimal fallback.
 */

import type { ModelSpec } from "../../types.js";
import { listModels } from "./registry/index.js";
import { mapRegistryEntryToModelSpec } from "./adapters.js";
import { recordRegistryFallback } from "./registryHealth.js";
import { FALLBACK_MODELS } from "./fallbackModels.js";

export interface GetModelRegistryResult {
  models: ModelSpec[];
  usedFallback: boolean;
}

/**
 * Get model registry for runtime. Uses Model HR registry; falls back to minimal
 * FALLBACK_MODELS only when registry is missing, empty, throws, or returns invalid data.
 * Never throws; always returns a valid result.
 */
export async function getModelRegistryForRuntime(): Promise<GetModelRegistryResult> {
  try {
    const entries = await listModels();
    if (entries.length > 0) {
      const models = entries.map(mapRegistryEntryToModelSpec);
      return { models, usedFallback: false };
    }
  } catch (e) {
    recordRegistryFallback(e instanceof Error ? e.message : String(e));
    return { models: FALLBACK_MODELS, usedFallback: true };
  }
  recordRegistryFallback("registry_empty");
  return { models: FALLBACK_MODELS, usedFallback: true };
}
