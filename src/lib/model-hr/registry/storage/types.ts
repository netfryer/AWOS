/**
 * Storage adapter interface for Model HR.
 */

import type { ModelPerformancePrior, ModelRegistryEntry, ModelObservation } from "../../types.js";

export interface StorageAdapter {
  loadModels(): Promise<ModelRegistryEntry[]>;
  saveModel(entry: ModelRegistryEntry): Promise<void>;
  /** Save entry, optionally removing an old entry with different id (for canonical id migration) */
  saveModelReplacing?(entry: ModelRegistryEntry, oldIdToRemove: string): Promise<void>;
  loadObservations(modelId: string, limit?: number): Promise<ModelObservation[]>;
  appendObservation(obs: ModelObservation): Promise<void>;
  loadPriors(modelId: string): Promise<ModelPerformancePrior[]>;
  savePriors(modelId: string, priors: ModelPerformancePrior[]): Promise<void>;
}
