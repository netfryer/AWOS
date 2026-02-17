/**
 * Remote stub adapter: reads config/models.<provider>.remote.json if present.
 * No network calls. Returns [] if file does not exist.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { ProviderConfigSchema } from "./providerModelSchema.js";
import type { ProviderAdapter, ProviderModel } from "./types.js";

export function createRemoteStubAdapter(
  providerId: string,
  configDir: string
): ProviderAdapter {
  const configPath = join(configDir, `models.${providerId}.remote.json`);

  return {
    providerId,
    async listModels(): Promise<ProviderModel[]> {
      try {
        const raw = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        const result = ProviderConfigSchema.safeParse(parsed);
        if (!result.success) {
          return [];
        }
        if (result.data.provider !== providerId) {
          return [];
        }
        return result.data.models;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return [];
        return [];
      }
    },
  };
}
