/**
 * Credentials interface for provider API access.
 * Phase 1: env-only; production will use secrets manager.
 * Never persist plaintext secrets to disk.
 */

export type ProviderId = string;

/** Credential status for UI display. */
export type CredentialStatus = "connected" | "missing";

/** Required credential fields per provider (for validation/UI). */
export interface ProviderCredentialSpec {
  providerId: ProviderId;
  /** Env var names required (e.g. OPENAI_API_KEY) */
  requiredEnvVars: string[];
  /** Human-readable label for UI */
  label?: string;
}

/** Result of credential check. */
export interface CredentialCheckResult {
  providerId: ProviderId;
  status: CredentialStatus;
  missingVars?: string[];
}

/** Interface for credential resolvers. Env-first; production can swap for secrets manager. */
export interface CredentialsResolver {
  checkStatus(providerId: ProviderId): CredentialCheckResult;
  /** Get credential value (e.g. API key). Returns undefined if missing. */
  getCredential(providerId: ProviderId, key: string): string | undefined;
}
