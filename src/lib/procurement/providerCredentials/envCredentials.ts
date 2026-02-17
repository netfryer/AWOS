/**
 * Env-based credentials resolver. Reads from process.env only.
 * Never writes secrets to disk.
 */

import type { CredentialsResolver, CredentialCheckResult } from "./types.js";

/** Known provider env var mappings. */
const PROVIDER_ENV_MAP: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
};

export function createEnvCredentialsResolver(): CredentialsResolver {
  return {
    checkStatus(providerId: string): CredentialCheckResult {
      const vars = PROVIDER_ENV_MAP[providerId.toLowerCase()] ?? [];
      const missing: string[] = [];
      for (const v of vars) {
        const val = process.env[v];
        if (!val || String(val).trim() === "") {
          missing.push(v);
        }
      }
      return {
        providerId,
        status: missing.length === 0 ? "connected" : "missing",
        ...(missing.length > 0 && { missingVars: missing }),
      };
    },
    getCredential(providerId: string, key: string): string | undefined {
      const vars = PROVIDER_ENV_MAP[providerId.toLowerCase()] ?? [];
      const envKey = key || vars[0];
      if (!envKey) return undefined;
      const val = process.env[envKey];
      return val && String(val).trim() !== "" ? String(val).trim() : undefined;
    },
  };
}

/** Get list of known providers for credential checks. */
export function getKnownProviders(): string[] {
  return Object.keys(PROVIDER_ENV_MAP);
}
