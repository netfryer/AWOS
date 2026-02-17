/**
 * Procurement types: tenant capability, credentials, allowlists/denylists.
 * Procurement manages what providers/models a tenant can use; Model HR remains canonical metadata.
 */

/** Single-tenant for now; design supports multi-tenant. */
export type TenantId = string;

/** Per-tenant model availability rules. Canonical ids: "<provider>/<modelId>". */
export interface TenantModelAvailability {
  allowedProviders?: string[];
  blockedProviders?: string[];
  allowedModelIds?: string[];
  blockedModelIds?: string[];
  /** Override allowedTiers per tenant (optional) */
  allowedTiers?: ("cheap" | "standard" | "premium")[];
  /** Default provider preference when multiple qualify (optional) */
  defaultProviderPreference?: string;
}

/** Provider subscription: whether provider is enabled for tenant. */
export interface ProviderSubscription {
  providerId: string;
  enabled: boolean;
}

/** Full tenant procurement config (non-secret). */
export interface TenantProcurementConfig {
  tenantId: TenantId;
  providerSubscriptions: ProviderSubscription[];
  modelAvailability: TenantModelAvailability;
  /** Optional: models user chose to ignore in recommendations */
  ignoredRecommendationModelIds?: string[];
  updatedAtISO?: string;
}

/** Procurement filter result for a single model. */
export type ProcurementFilterReason =
  | "procurement_not_subscribed"
  | "credentials_missing"
  | "procurement_blocked_model"
  | "procurement_blocked_provider"
  | "procurement_not_allowed";

export interface ProcurementFilterResult {
  allowed: boolean;
  reason?: ProcurementFilterReason;
}
