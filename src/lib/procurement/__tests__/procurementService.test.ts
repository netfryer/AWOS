import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  getTenantConfig,
  setTenantConfig,
  getProviderStatus,
  filterRegistryEntriesForTenant,
  createFileTenantConfigStorage,
} from "../index.js";
import type { CredentialsResolver } from "../providerCredentials/types.js";
import type { TenantProcurementConfig } from "../types.js";
import type { ModelRegistryEntry } from "../../model-hr/types.js";

const mockCredentialsConnected: CredentialsResolver = {
  checkStatus: (providerId) => ({ providerId, status: "connected" as const }),
  getCredential: () => "mock",
};

function makeEntry(
  id: string,
  provider: string,
  modelId: string,
  status: "active" | "probation" | "disabled" = "active"
): ModelRegistryEntry {
  return {
    id,
    identity: { provider, modelId, status },
    displayName: modelId,
    pricing: { inPer1k: 0.001, outPer1k: 0.002, currency: "USD" },
    expertise: { general: 0.8 },
    reliability: 0.9,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
  };
}

describe("ProcurementService", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "procurement-test-"));
    process.env.PROCUREMENT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    try {
      await rm(dataDir, { recursive: true });
    } catch {
      /* ignore */
    }
    delete process.env.PROCUREMENT_DATA_DIR;
  });

  it("getTenantConfig returns null when no config exists", async () => {
    const storage = createFileTenantConfigStorage();
    const config = await getTenantConfig("default", storage);
    expect(config).toBeNull();
  });

  it("setTenantConfig and getTenantConfig round-trip", async () => {
    const storage = createFileTenantConfigStorage();
    const config: TenantProcurementConfig = {
      tenantId: "default",
      providerSubscriptions: [
        { providerId: "openai", enabled: true },
        { providerId: "anthropic", enabled: false },
      ],
      modelAvailability: {
        allowedModelIds: ["openai/gpt-4o"],
        blockedModelIds: ["openai/gpt-3.5-turbo"],
      },
    };
    await setTenantConfig(config, storage);
    const loaded = await getTenantConfig("default", storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.tenantId).toBe("default");
    expect(loaded?.providerSubscriptions).toHaveLength(2);
    expect(loaded?.modelAvailability?.allowedModelIds).toContain("openai/gpt-4o");
    expect(loaded?.modelAvailability?.blockedModelIds).toContain("openai/gpt-3.5-turbo");
  });

  it("filterRegistryEntriesForTenant allows all when config is null", () => {
    const credentials = mockCredentialsConnected;
    const entries = [
      makeEntry("openai/gpt-4o", "openai", "gpt-4o"),
      makeEntry("anthropic/claude-sonnet", "anthropic", "claude-sonnet"),
    ];
    const { allowed, filtered } = filterRegistryEntriesForTenant(entries, null, credentials);
    expect(allowed).toHaveLength(2);
    expect(filtered).toHaveLength(0);
  });

  it("filterRegistryEntriesForTenant blocks by blockedModelIds", () => {
    const credentials = mockCredentialsConnected;
    const config: TenantProcurementConfig = {
      tenantId: "default",
      providerSubscriptions: [{ providerId: "openai", enabled: true }],
      modelAvailability: {
        blockedModelIds: ["openai/gpt-3.5-turbo"],
      },
    };
    const entries = [
      makeEntry("openai/gpt-4o", "openai", "gpt-4o"),
      makeEntry("openai/gpt-3.5-turbo", "openai", "gpt-3.5-turbo"),
    ];
    const { allowed, filtered } = filterRegistryEntriesForTenant(entries, config, credentials);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].id).toBe("openai/gpt-4o");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].reason).toBe("procurement_blocked_model");
  });

  it("filterRegistryEntriesForTenant enforces allowedModelIds when non-empty", () => {
    const credentials = mockCredentialsConnected;
    const config: TenantProcurementConfig = {
      tenantId: "default",
      providerSubscriptions: [
        { providerId: "openai", enabled: true },
        { providerId: "anthropic", enabled: true },
      ],
      modelAvailability: {
        allowedModelIds: ["openai/gpt-4o"],
      },
    };
    const entries = [
      makeEntry("openai/gpt-4o", "openai", "gpt-4o"),
      makeEntry("openai/gpt-4o-mini", "openai", "gpt-4o-mini"),
      makeEntry("anthropic/claude-sonnet", "anthropic", "claude-sonnet"),
    ];
    const { allowed, filtered } = filterRegistryEntriesForTenant(entries, config, credentials);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].id).toBe("openai/gpt-4o");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((f) => f.reason === "procurement_not_allowed")).toBe(true);
  });

  it("filterRegistryEntriesForTenant filters by provider when disabled", () => {
    const credentials = mockCredentialsConnected;
    const config: TenantProcurementConfig = {
      tenantId: "default",
      providerSubscriptions: [
        { providerId: "openai", enabled: true },
        { providerId: "anthropic", enabled: false },
      ],
      modelAvailability: {},
    };
    const entries = [
      makeEntry("openai/gpt-4o", "openai", "gpt-4o"),
      makeEntry("anthropic/claude-sonnet", "anthropic", "claude-sonnet"),
    ];
    const { allowed, filtered } = filterRegistryEntriesForTenant(entries, config, credentials);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].id).toBe("openai/gpt-4o");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].reason).toBe("procurement_not_subscribed");
  });

  it("getProviderStatus returns status for providers", async () => {
    const status = await getProviderStatus("default", ["openai", "anthropic"]);
    expect(status).toHaveLength(2);
    expect(status.map((s) => s.providerId)).toContain("openai");
    expect(status.map((s) => s.providerId)).toContain("anthropic");
  });
});
