/**
 * JSON config adapter: reads config/models.<provider>.json (local config).
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { ProviderConfigSchema } from "./providerModelSchema.js";
import type { ProviderAdapter, ProviderModel } from "./types.js";

export function createJSONConfigAdapter(
  providerId: string,
  configDir: string
): ProviderAdapter {
  const configPath = join(configDir, `models.${providerId}.json`);

  return {
    providerId,
    async listModels(): Promise<ProviderModel[]> {
      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const result = ProviderConfigSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Invalid config ${configPath}: ${result.error.message}`);
      }
      if (result.data.provider !== providerId) {
        throw new Error(`Config provider mismatch: expected ${providerId}, got ${result.data.provider}`);
      }
      return result.data.models;
    },
  };
}
