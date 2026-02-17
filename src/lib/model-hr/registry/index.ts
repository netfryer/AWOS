/**
 * Registry module: singleton service and public API.
 */

import type { ListModelsFilters, ModelRegistryEntry } from "../types.js";
import { FileStorageAdapter } from "./storage/fileStorage.js";
import { RegistryService } from "./registryService.js";

let singleton: RegistryService | null = null;

function makeFileRegistryService(): RegistryService {
  if (singleton) return singleton;
  const storage = new FileStorageAdapter();
  singleton = new RegistryService(storage);
  return singleton;
}

export { makeFileRegistryService, RegistryService };
export { FileStorageAdapter } from "./storage/fileStorage.js";
export type { StorageAdapter } from "./storage/types.js";

export async function listModels(filters?: ListModelsFilters): Promise<ModelRegistryEntry[]> {
  return makeFileRegistryService().listModels(filters);
}

export async function getModel(modelId: string): Promise<ModelRegistryEntry | null> {
  return makeFileRegistryService().getModel(modelId);
}

export async function upsertModel(entry: ModelRegistryEntry): Promise<ModelRegistryEntry> {
  return makeFileRegistryService().upsertModel(entry);
}

export async function upsertModelReplacing(
  entry: ModelRegistryEntry,
  oldIdToRemove?: string
): Promise<ModelRegistryEntry> {
  return makeFileRegistryService().upsertModelReplacing(entry, oldIdToRemove);
}

export async function disableModel(modelId: string, reason: string): Promise<ModelRegistryEntry | null> {
  return makeFileRegistryService().disableModel(modelId, reason);
}

export async function setModelStatus(
  modelId: string,
  status: "active" | "probation"
): Promise<ModelRegistryEntry | null> {
  return makeFileRegistryService().setModelStatus(modelId, status);
}

export async function loadPriorsForModel(modelId: string) {
  return makeFileRegistryService().getStorage().loadPriors(modelId);
}

export async function loadObservationsForModel(modelId: string, limit: number = 50) {
  return makeFileRegistryService().getStorage().loadObservations(modelId, limit);
}
