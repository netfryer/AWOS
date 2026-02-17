import { describe, it, expect } from "vitest";
import {
  recommendNewFromRecruiting,
  recommendFromCanaryGraduates,
  recommendEnableProvider,
} from "../recommendations/heuristics.js";
import type { ModelRegistryEntry } from "../../model-hr/types.js";

function makeEntry(
  id: string,
  provider: string,
  modelId: string
): ModelRegistryEntry {
  return {
    id,
    identity: { provider, modelId, status: "active" },
    displayName: modelId,
    pricing: { inPer1k: 0.001, outPer1k: 0.002, currency: "USD" },
    expertise: { general: 0.8 },
    reliability: 0.9,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
  };
}

describe("Procurement recommendations", () => {
  it("recommendNewFromRecruiting returns new models not in allowlist", () => {
    const report = {
      created: [{ canonicalId: "openai/gpt-5", modelId: "gpt-5" }],
    };
    const tenantAllowedIds = new Set<string>();
    const registryById = new Map<string, ModelRegistryEntry>([
      ["openai/gpt-5", makeEntry("openai/gpt-5", "openai", "gpt-5")],
    ]);
    const recs = recommendNewFromRecruiting(report, tenantAllowedIds, registryById);
    expect(recs).toHaveLength(1);
    expect(recs[0].canonicalId).toBe("openai/gpt-5");
    expect(recs[0].reason).toBe("new_model_from_recruiting");
  });

  it("recommendNewFromRecruiting skips models already in allowlist", () => {
    const report = {
      created: [{ canonicalId: "openai/gpt-5", modelId: "gpt-5" }],
    };
    const tenantAllowedIds = new Set(["openai/gpt-5"]);
    const registryById = new Map<string, ModelRegistryEntry>([
      ["openai/gpt-5", makeEntry("openai/gpt-5", "openai", "gpt-5")],
    ]);
    const recs = recommendNewFromRecruiting(report, tenantAllowedIds, registryById);
    expect(recs).toHaveLength(0);
  });

  it("recommendFromCanaryGraduates returns promoted models", () => {
    const cycle = {
      rows: [
        {
          modelId: "anthropic/claude-sonnet",
          action: "promoted",
          canaryAvgQuality: 0.9,
          failedCount: 0,
          statusAfter: "active",
        },
      ],
    };
    const tenantAllowedIds = new Set<string>();
    const registryById = new Map<string, ModelRegistryEntry>([
      ["anthropic/claude-sonnet", makeEntry("anthropic/claude-sonnet", "anthropic", "claude-sonnet")],
    ]);
    const recs = recommendFromCanaryGraduates(cycle, tenantAllowedIds, registryById);
    expect(recs).toHaveLength(1);
    expect(recs[0].reason).toBe("canary_graduate");
  });

  it("recommendEnableProvider returns disabled providers with models", () => {
    const providerSubscriptions = [
      { providerId: "openai", enabled: true },
      { providerId: "anthropic", enabled: false },
    ];
    const registryByProvider = new Map<string, ModelRegistryEntry[]>([
      ["openai", [makeEntry("openai/gpt-4o", "openai", "gpt-4o")]],
      ["anthropic", [makeEntry("anthropic/claude-sonnet", "anthropic", "claude-sonnet")]],
    ]);
    const recs = recommendEnableProvider(
      ["openai", "anthropic"],
      providerSubscriptions,
      registryByProvider
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].providerId).toBe("anthropic");
  });
});
