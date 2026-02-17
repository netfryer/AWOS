/**
 * Registry service: CRUD for models, filtering, disable.
 */

import type {
  ListModelsFilters,
  ModelRegistryEntry,
  ModelStatus,
} from "../types.js";
import type { StorageAdapter } from "./storage/types.js";

export class RegistryService {
  constructor(private storage: StorageAdapter) {}

  getStorage(): StorageAdapter {
    return this.storage;
  }

  async listModels(filters?: ListModelsFilters): Promise<ModelRegistryEntry[]> {
    let models = await this.storage.loadModels();

    if (!filters?.includeDisabled) {
      models = models.filter((m) => m.identity.status !== "disabled");
    }

    if (filters?.status != null) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      models = models.filter((m) => statuses.includes(m.identity.status));
    }

    if (filters?.provider != null) {
      models = models.filter((m) => m.identity.provider === filters.provider);
    }

    if (filters?.tiers != null && filters.tiers.length > 0) {
      const tierSet = new Set(filters.tiers);
      models = models.filter((m) => {
        const allowed = m.governance?.allowedTiers;
        if (!allowed || allowed.length === 0) return true;
        return allowed.some((t) => tierSet.has(t));
      });
    }

    if (filters?.taskType != null) {
      models = models.filter((m) => {
        const exp = m.expertise;
        if (!exp) return true;
        return Object.prototype.hasOwnProperty.call(exp, filters!.taskType!);
      });
    }

    return models;
  }

  async getModel(modelId: string): Promise<ModelRegistryEntry | null> {
    const models = await this.storage.loadModels();
    const byId = models.find((m) => m.id === modelId);
    if (byId) return byId;
    const byAlias = models.find(
      (m) =>
        m.identity.aliases?.includes(modelId) || m.identity.modelId === modelId
    );
    return byAlias ?? null;
  }

  async upsertModel(entry: ModelRegistryEntry): Promise<ModelRegistryEntry> {
    const now = new Date().toISOString();
    const existing = await this.getModel(entry.id);
    const toSave: ModelRegistryEntry = {
      ...entry,
      createdAtISO: existing?.createdAtISO ?? now,
      updatedAtISO: now,
    };
    await this.storage.saveModel(toSave);
    return toSave;
  }

  /** Upsert, optionally replacing an old entry with different id (for canonical id migration). */
  async upsertModelReplacing(
    entry: ModelRegistryEntry,
    oldIdToRemove?: string
  ): Promise<ModelRegistryEntry> {
    const now = new Date().toISOString();
    const existingByNew = await this.getModel(entry.id);
    const existingByOld = oldIdToRemove ? await this.getModel(oldIdToRemove) : null;
    const existing = existingByNew ?? existingByOld;
    const toSave: ModelRegistryEntry = {
      ...entry,
      createdAtISO: existing?.createdAtISO ?? now,
      updatedAtISO: now,
    };
    const adapter = this.storage as { saveModelReplacing?: (e: ModelRegistryEntry, o: string) => Promise<void> };
    if (oldIdToRemove && adapter.saveModelReplacing) {
      await adapter.saveModelReplacing(toSave, oldIdToRemove);
    } else {
      await this.storage.saveModel(toSave);
    }
    return toSave;
  }

  async disableModel(modelId: string, reason: string): Promise<ModelRegistryEntry | null> {
    const model = await this.getModel(modelId);
    if (!model) return null;
    const now = new Date().toISOString();
    const updated: ModelRegistryEntry = {
      ...model,
      identity: {
        ...model.identity,
        status: "disabled" as ModelStatus,
        disabledAtISO: now,
        disabledReason: reason,
      },
      updatedAtISO: now,
    };
    await this.storage.saveModel(updated);
    return updated;
  }

  /** Manual override: set model status to active or probation (graduate/probation). */
  async setModelStatus(
    modelId: string,
    status: "active" | "probation"
  ): Promise<ModelRegistryEntry | null> {
    const model = await this.getModel(modelId);
    if (!model) return null;
    const now = new Date().toISOString();
    const updated: ModelRegistryEntry = {
      ...model,
      identity: {
        ...model.identity,
        status: status as ModelStatus,
        disabledAtISO: undefined,
        disabledReason: undefined,
      },
      updatedAtISO: now,
    };
    await this.storage.saveModel(updated);
    return updated;
  }
}
