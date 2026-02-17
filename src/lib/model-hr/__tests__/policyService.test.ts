import { describe, it, expect } from "vitest";
import { PolicyService } from "../policy/policyService.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import {
  FIXTURE_MODEL_ACTIVE,
  FIXTURE_MODEL_DISABLED,
  FIXTURE_MODEL_DEPRECATED,
  FIXTURE_MODEL_TIER_CHEAP_ONLY,
  FIXTURE_MODEL_BLOCKED_TASK,
  FIXTURE_MODEL_RESTRICTED_USE,
  FIXTURE_MODEL_KILL_SWITCH,
  FIXTURE_MODELS,
} from "./fixtures.js";

function createPolicyService() {
  const storage = new InMemoryStorageAdapter(FIXTURE_MODELS);
  const registry = new RegistryService(storage);
  return new PolicyService(registry);
}

const BASE_CTX = {
  tierProfile: "standard" as const,
  taskType: "code",
  difficulty: "medium",
  budgetRemainingUSD: 1,
};

describe("PolicyService.isEligible", () => {
  it("disabled => ineligible reason=disabled", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_DISABLED, BASE_CTX);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("disabled");
    expect(result.detail).toBeDefined();
  });

  it("allowedTiers mismatch => tier_not_allowed", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_TIER_CHEAP_ONLY, {
      ...BASE_CTX,
      tierProfile: "premium",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("tier_not_allowed");
    expect(result.detail).toContain("premium");
  });

  it("allowedTiers match => eligible", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_TIER_CHEAP_ONLY, {
      ...BASE_CTX,
      tierProfile: "cheap",
    });
    expect(result.eligible).toBe(true);
  });

  it("blockedProviders => provider_blocked", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_ACTIVE, {
      ...BASE_CTX,
      blockedProviders: ["openai"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("provider_blocked");
    expect(result.detail).toContain("openai");
  });

  it("blockedTaskTypes => task_type_blocked", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_BLOCKED_TASK, {
      ...BASE_CTX,
      taskType: "analysis",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("task_type_blocked");
    expect(result.detail).toContain("analysis");
  });

  it("blockedTaskTypes mismatch => eligible", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_BLOCKED_TASK, {
      ...BASE_CTX,
      taskType: "code",
    });
    expect(result.eligible).toBe(true);
  });

  it("restricted_use_case from guardrails.restrictedUseCases overlap", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_RESTRICTED_USE, {
      ...BASE_CTX,
      useCaseTags: ["pii", "other"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("restricted_use_case");
    expect(result.detail).toContain("restrictedUseCases");
  });

  it("restricted_use_case no overlap => eligible", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_RESTRICTED_USE, {
      ...BASE_CTX,
      useCaseTags: ["general"],
    });
    expect(result.eligible).toBe(true);
  });

  it("deprecated => eligible but include detail warning", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_DEPRECATED, BASE_CTX);
    expect(result.eligible).toBe(true);
    expect(result.detail).toContain("deprecated");
    expect(result.detail).toContain("migrat");
  });

  it("active model with no restrictions => eligible", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_ACTIVE, BASE_CTX);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("killSwitch true => ineligible reason=kill_switch", () => {
    const policy = createPolicyService();
    const result = policy.isEligible(FIXTURE_MODEL_KILL_SWITCH, BASE_CTX);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("kill_switch");
    expect(result.detail).toContain("kill switch");
  });

  it("killSwitch false or absent => eligible", () => {
    const policy = createPolicyService();
    const modelNoKillSwitch = { ...FIXTURE_MODEL_ACTIVE, governance: { killSwitch: false } };
    const result = policy.isEligible(modelNoKillSwitch, BASE_CTX);
    expect(result.eligible).toBe(true);
  });
});
