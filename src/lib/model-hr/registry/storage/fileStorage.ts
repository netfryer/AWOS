/**
 * File-backed storage adapter for Model HR.
 * loadModels() never throws; invalid entries are skipped with warnings.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ModelObservation, ModelPerformancePrior, ModelRegistryEntry } from "../../types.js";
import type { StorageAdapter } from "./types.js";
import { ModelRegistryEntrySchema } from "../../schemas.js";
import { getObservationsCap } from "../../config.js";

const DEFAULT_OBSERVATIONS_LIMIT = 200;

function getDataDir(): string {
  const envDir = process.env.MODEL_HR_DATA_DIR;
  if (envDir) return envDir;
  return join(process.cwd(), ".data", "model-hr");
}

function formatValidationError(id: string | undefined, modelId: string | undefined, err: unknown): string {
  const parts: string[] = [];
  if (id) parts.push(`id=${id}`);
  if (modelId) parts.push(`modelId=${modelId}`);
  const msg = err instanceof Error ? err.message : String(err);
  parts.push(msg.slice(0, 80));
  return `[ModelHR] Invalid registry entry: ${parts.join(" ")}`;
}

export class FileStorageAdapter implements StorageAdapter {
  private readonly dataDir: string;
  private readonly modelsPath: string;
  private readonly observationsDir: string;
  private readonly priorsDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? getDataDir();
    this.modelsPath = join(this.dataDir, "models.json");
    this.observationsDir = join(this.dataDir, "observations");
    this.priorsDir = join(this.dataDir, "priors");
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private async ensureAllDirs(): Promise<void> {
    await this.ensureDir(this.dataDir);
    await this.ensureDir(this.observationsDir);
    await this.ensureDir(this.priorsDir);
  }

  async loadModels(): Promise<ModelRegistryEntry[]> {
    try {
      await this.ensureAllDirs();
    } catch {
      return [];
    }
    let raw: string;
    try {
      raw = await readFile(this.modelsPath, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const valid: ModelRegistryEntry[] = [];
    for (const item of parsed) {
      const result = ModelRegistryEntrySchema.safeParse(item);
      if (result.success) {
        valid.push(result.data as ModelRegistryEntry);
      } else {
        const id = typeof item === "object" && item !== null && "id" in item ? String((item as { id: unknown }).id) : undefined;
        const modelId = typeof item === "object" && item !== null && "identity" in item
          ? typeof (item as { identity: unknown }).identity === "object" && (item as { identity: Record<string, unknown> }).identity !== null
            ? String((item as { identity: { modelId?: unknown } }).identity?.modelId ?? "?")
            : undefined
          : undefined;
        console.warn(formatValidationError(id, modelId, (result.error as { issues?: { message?: string }[] }).issues?.[0]?.message ?? result.error.message));
      }
    }
    return valid;
  }

  async saveModel(entry: ModelRegistryEntry): Promise<void> {
    const result = ModelRegistryEntrySchema.safeParse(entry);
    if (!result.success) {
      console.warn(formatValidationError(entry.id, entry.identity?.modelId, (result.error as { issues?: { message?: string }[] }).issues?.[0]?.message ?? result.error.message));
      return;
    }
    try {
      await this.ensureAllDirs();
    } catch {
      return;
    }
    const models = await this.loadModels();
    const idx = models.findIndex((m) => m.id === entry.id);
    if (idx >= 0) {
      models[idx] = entry;
    } else {
      models.push(entry);
    }
    try {
      await writeFile(this.modelsPath, JSON.stringify(models, null, 2), "utf-8");
    } catch {
      /* I2: Storage write failures do not fail runs */
    }
  }

  async saveModelReplacing(entry: ModelRegistryEntry, oldIdToRemove: string): Promise<void> {
    const result = ModelRegistryEntrySchema.safeParse(entry);
    if (!result.success) {
      console.warn(formatValidationError(entry.id, entry.identity?.modelId, (result.error as { issues?: { message?: string }[] }).issues?.[0]?.message ?? result.error.message));
      return;
    }
    try {
      await this.ensureAllDirs();
    } catch {
      return;
    }
    let models = await this.loadModels();
    models = models.filter((m) => m.id !== oldIdToRemove);
    const idx = models.findIndex((m) => m.id === entry.id);
    if (idx >= 0) {
      models[idx] = entry;
    } else {
      models.push(entry);
    }
    try {
      await writeFile(this.modelsPath, JSON.stringify(models, null, 2), "utf-8");
    } catch {
      /* I2: Storage write failures do not fail runs */
    }
  }

  async loadObservations(modelId: string, limit: number = DEFAULT_OBSERVATIONS_LIMIT): Promise<ModelObservation[]> {
    await this.ensureAllDirs();
    const safeId = modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = join(this.observationsDir, `${safeId}.json`);
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const arr = parsed as ModelObservation[];
      arr.sort((a, b) => (b.tsISO ?? "").localeCompare(a.tsISO ?? ""));
      return arr.slice(0, limit);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }
  }

  async appendObservation(obs: ModelObservation): Promise<void> {
    await this.ensureAllDirs();
    const safeId = obs.modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = join(this.observationsDir, `${safeId}.json`);
    let arr: ModelObservation[];
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      arr = Array.isArray(parsed) ? (parsed as ModelObservation[]) : [];
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") arr = [];
      else throw err;
    }
    arr.push(obs);
    const cap = getObservationsCap();
    if (arr.length > cap) {
      arr.sort((a, b) => (b.tsISO ?? "").localeCompare(a.tsISO ?? ""));
      arr = arr.slice(0, cap);
    }
    try {
      await writeFile(path, JSON.stringify(arr, null, 2), "utf-8");
    } catch {
      /* I2: Storage write failures do not fail runs */
    }
  }

  async loadPriors(modelId: string): Promise<ModelPerformancePrior[]> {
    await this.ensureAllDirs();
    const safeId = modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = join(this.priorsDir, `${safeId}.json`);
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed as ModelPerformancePrior[];
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }
  }

  async savePriors(modelId: string, priors: ModelPerformancePrior[]): Promise<void> {
    await this.ensureAllDirs();
    const safeId = modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = join(this.priorsDir, `${safeId}.json`);
    await writeFile(path, JSON.stringify(priors, null, 2), "utf-8");
  }
}
