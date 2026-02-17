/**
 * Provider adapter types for Model HR catalog ingestion.
 * ProviderModel aligns with ProviderModelSchema (Zod) used in sync.
 */

import type { ProviderModel } from "./providerModelSchema.js";

export type { ProviderModel };

export interface ProviderAdapter {
  providerId: string;
  listModels(): Promise<ProviderModel[]>;
}
