/**
 * Procurement: tenant capability, credentials, allowlists.
 * Thin integration with Model HR; never modifies registry.
 */

export type {
  TenantId,
  TenantModelAvailability,
  ProviderSubscription,
  TenantProcurementConfig,
  ProcurementFilterReason,
  ProcurementFilterResult,
} from "./types.js";

export {
  getTenantConfig,
  setTenantConfig,
  getProviderStatus,
  filterRegistryEntriesForTenant,
} from "./procurementService.js";
export type { ProviderStatus, FilterRegistryResult } from "./procurementService.js";

export { getProcurementRecommendations } from "./recommendations/recommendationService.js";
export type { ProcurementRecommendationResult } from "./recommendations/recommendationService.js";
export type { ProcurementRecommendation } from "./recommendations/heuristics.js";

export { createEnvCredentialsResolver } from "./providerCredentials/envCredentials.js";
export { getKnownProviders } from "./providerCredentials/envCredentials.js";
export type { CredentialsResolver, CredentialCheckResult } from "./providerCredentials/types.js";

export { createFileTenantConfigStorage } from "./tenantConfig/fileTenantConfig.js";
export type { TenantConfigStorage } from "./tenantConfig/types.js";
