/**
 * ProcurementService: tenant config, provider status, model filtering.
 * Thin integration with Model HR; never modifies registry.
 */

import type { ModelRegistryEntry } from "../model-hr/types.js";
import type { TenantProcurementConfig, ProcurementFilterReason } from "./types.js";
import type { TenantConfigStorage } from "./tenantConfig/types.js";
import type { CredentialsResolver } from "./providerCredentials/types.js";
import { createFileTenantConfigStorage } from "./tenantConfig/fileTenantConfig.js";
import { createEnvCredentialsResolver } from "./providerCredentials/envCredentials.js";

const DEFAULT_TENANT = "default";

export interface ProviderStatus {
  providerId: string;
  enabled: boolean;
  credentialStatus: "connected" | "missing";
  missingEnvVars?: string[];
}

export interface FilterRegistryResult {
  allowed: ModelRegistryEntry[];
  filtered: Array<{ entry: ModelRegistryEntry; reason: ProcurementFilterReason }>;
}

let defaultTenantStorage: TenantConfigStorage | null = null;
let defaultCredentials: CredentialsResolver | null = null;

function getTenantStorage(): TenantConfigStorage {
  if (!defaultTenantStorage) {
    defaultTenantStorage = createFileTenantConfigStorage();
  }
  return defaultTenantStorage;
}

function getCredentials(): CredentialsResolver {
  if (!defaultCredentials) {
    defaultCredentials = createEnvCredentialsResolver();
  }
  return defaultCredentials;
}

/** Get default tenant config. Returns null if missing; never throws. */
export async function getTenantConfig(
  tenantId: string = DEFAULT_TENANT,
  storage?: TenantConfigStorage
): Promise<TenantProcurementConfig | null> {
  const s = storage ?? getTenantStorage();
  try {
    return await s.getTenantConfig(tenantId);
  } catch {
    return null;
  }
}

/** Save tenant config. Non-secret only. */
export async function setTenantConfig(
  config: TenantProcurementConfig,
  storage?: TenantConfigStorage
): Promise<void> {
  const s = storage ?? getTenantStorage();
  await s.setTenantConfig(config);
}

/** Get provider status (enabled + credentials) for a tenant. */
export async function getProviderStatus(
  tenantId: string = DEFAULT_TENANT,
  providerIds?: string[],
  storage?: TenantConfigStorage,
  credentials?: CredentialsResolver
): Promise<ProviderStatus[]> {
  const config = await getTenantConfig(tenantId, storage);
  const creds = credentials ?? getCredentials();
  const providers = providerIds ?? ["openai", "anthropic"];
  const subs = new Map(
    (config?.providerSubscriptions ?? []).map((s) => [s.providerId, s.enabled])
  );
  return providers.map((pid) => {
    const check = creds.checkStatus(pid);
    const enabled = subs.get(pid) ?? true;
    return {
      providerId: pid,
      enabled,
      credentialStatus: check.status,
      ...(check.missingVars?.length && { missingEnvVars: check.missingVars }),
    };
  });
}

/** Filter registry entries by tenant procurement config. */
export function filterRegistryEntriesForTenant(
  entries: ModelRegistryEntry[],
  config: TenantProcurementConfig | null,
  credentials: CredentialsResolver
): FilterRegistryResult {
  const allowed: ModelRegistryEntry[] = [];
  const filtered: Array<{ entry: ModelRegistryEntry; reason: ProcurementFilterReason }> = [];

  if (!config) {
    return { allowed: entries, filtered: [] };
  }

  const subs = new Map(
    config.providerSubscriptions.map((s) => [s.providerId, s.enabled])
  );
  const avail = config.modelAvailability;
  const blockedProviders = new Set(avail.blockedProviders ?? []);
  const allowedProviders = avail.allowedProviders?.length
    ? new Set(avail.allowedProviders)
    : null;
  const blockedModelIds = new Set(
    (avail.blockedModelIds ?? []).map((id) => id.toLowerCase())
  );
  const allowedModelIds = avail.allowedModelIds?.length
    ? new Set((avail.allowedModelIds ?? []).map((id) => id.toLowerCase()))
    : null;

  for (const entry of entries) {
    const canonicalId = entry.id;
    const provider = entry.identity.provider;
    const providerLower = provider.toLowerCase();
    const canonicalLower = canonicalId.toLowerCase();

    if (blockedProviders.has(providerLower) || blockedModelIds.has(canonicalLower)) {
      filtered.push({
        entry,
        reason: blockedModelIds.has(canonicalLower)
          ? "procurement_blocked_model"
          : "procurement_blocked_provider",
      });
      continue;
    }

    const subEnabled = subs.get(providerLower) ?? true;
    if (!subEnabled) {
      filtered.push({ entry, reason: "procurement_not_subscribed" });
      continue;
    }

    const credCheck = credentials.checkStatus(providerLower);
    if (credCheck.status === "missing") {
      filtered.push({ entry, reason: "credentials_missing" });
      continue;
    }

    if (allowedProviders && !allowedProviders.has(providerLower)) {
      filtered.push({ entry, reason: "procurement_not_subscribed" });
      continue;
    }

    if (allowedModelIds && !allowedModelIds.has(canonicalLower)) {
      filtered.push({ entry, reason: "procurement_not_allowed" });
      continue;
    }

    allowed.push(entry);
  }

  return { allowed, filtered };
}
