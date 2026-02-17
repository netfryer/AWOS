/**
 * In-memory StorageAdapter for tests. No filesystem or network.
 */

import type {
  ModelObservation,
  ModelPerformancePrior,
  ModelRegistryEntry,
} from "../types.js";
import type { StorageAdapter } from "../registry/storage/types.js";

export class InMemoryStorageAdapter implements StorageAdapter {
  private models: ModelRegistryEntry[] = [];
  private observations: Map<string, ModelObservation[]> = new Map();
  private priors: Map<string, ModelPerformancePrior[]> = new Map();

  constructor(initialModels?: ModelRegistryEntry[]) {
    if (initialModels?.length) {
      this.models = [...initialModels];
    }
  }

  async loadModels(): Promise<ModelRegistryEntry[]> {
    return [...this.models];
  }

  async saveModel(entry: ModelRegistryEntry): Promise<void> {
    const idx = this.models.findIndex((m) => m.id === entry.id);
    if (idx >= 0) {
      this.models[idx] = entry;
    } else {
      this.models.push(entry);
    }
  }

  async saveModelReplacing(entry: ModelRegistryEntry, oldIdToRemove: string): Promise<void> {
    this.models = this.models.filter((m) => m.id !== oldIdToRemove);
    const idx = this.models.findIndex((m) => m.id === entry.id);
    if (idx >= 0) {
      this.models[idx] = entry;
    } else {
      this.models.push(entry);
    }
  }

  async loadObservations(
    modelId: string,
    limit: number = 200
  ): Promise<ModelObservation[]> {
    const arr = this.observations.get(modelId) ?? [];
    const sorted = [...arr].sort((a, b) =>
      (b.tsISO ?? "").localeCompare(a.tsISO ?? "")
    );
    return sorted.slice(0, limit);
  }

  async appendObservation(obs: ModelObservation): Promise<void> {
    const arr = this.observations.get(obs.modelId) ?? [];
    arr.push(obs);
    this.observations.set(obs.modelId, arr);
  }

  async loadPriors(modelId: string): Promise<ModelPerformancePrior[]> {
    return [...(this.priors.get(modelId) ?? [])];
  }

  async savePriors(
    modelId: string,
    priors: ModelPerformancePrior[]
  ): Promise<void> {
    this.priors.set(modelId, [...priors]);
  }

  /** Test helper: seed observations directly */
  seedObservations(modelId: string, obs: ModelObservation[]): void {
    this.observations.set(modelId, [...obs]);
  }
}
