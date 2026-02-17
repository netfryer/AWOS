/**
 * Test fixtures for Model HR.
 */

import type {
  ModelRegistryEntry,
  ModelObservation,
} from "../types.js";

const now = "2025-01-15T12:00:00.000Z";

export const FIXTURE_MODEL_ACTIVE: ModelRegistryEntry = {
  id: "gpt-4o",
  identity: {
    provider: "openai",
    modelId: "gpt-4o",
    status: "active",
  },
  displayName: "GPT-4o",
  pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
  expertise: { code: 0.92, writing: 0.88, analysis: 0.9, general: 0.9 },
  reliability: 0.98,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_DISABLED: ModelRegistryEntry = {
  id: "gpt-4o-disabled",
  identity: {
    provider: "openai",
    modelId: "gpt-4o-disabled",
    status: "disabled",
    disabledReason: "Test disable",
  },
  displayName: "GPT-4o Disabled",
  pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
  expertise: { code: 0.9, general: 0.9 },
  reliability: 0.9,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_DEPRECATED: ModelRegistryEntry = {
  id: "gpt-4-deprecated",
  identity: {
    provider: "openai",
    modelId: "gpt-4-deprecated",
    status: "deprecated",
  },
  displayName: "GPT-4 Deprecated",
  pricing: { inPer1k: 0.03, outPer1k: 0.06, currency: "USD" },
  expertise: { code: 0.85, general: 0.85 },
  reliability: 0.85,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_PROBATION: ModelRegistryEntry = {
  id: "claude-probation",
  identity: {
    provider: "anthropic",
    modelId: "claude-probation",
    status: "probation",
  },
  displayName: "Claude Probation",
  pricing: { inPer1k: 0.003, outPer1k: 0.015, currency: "USD" },
  expertise: { code: 0.8, general: 0.8 },
  reliability: 0.75,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_TIER_CHEAP_ONLY: ModelRegistryEntry = {
  id: "model-cheap-only",
  identity: {
    provider: "openai",
    modelId: "model-cheap-only",
    status: "active",
  },
  displayName: "Cheap Only",
  pricing: { inPer1k: 0.0001, outPer1k: 0.0004, currency: "USD" },
  governance: { allowedTiers: ["cheap"] },
  expertise: { general: 0.7 },
  reliability: 0.8,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_BLOCKED_TASK: ModelRegistryEntry = {
  id: "model-no-analysis",
  identity: {
    provider: "anthropic",
    modelId: "model-no-analysis",
    status: "active",
  },
  displayName: "No Analysis",
  pricing: { inPer1k: 0.003, outPer1k: 0.015, currency: "USD" },
  governance: { blockedTaskTypes: ["analysis"] },
  expertise: { code: 0.9, writing: 0.9, general: 0.9 },
  reliability: 0.9,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_RESTRICTED_USE: ModelRegistryEntry = {
  id: "model-restricted",
  identity: {
    provider: "openai",
    modelId: "model-restricted",
    status: "active",
  },
  displayName: "Restricted Use",
  pricing: { inPer1k: 0.002, outPer1k: 0.008, currency: "USD" },
  guardrails: { restrictedUseCases: ["pii", "health"] },
  expertise: { general: 0.85 },
  reliability: 0.9,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODEL_KILL_SWITCH: ModelRegistryEntry = {
  id: "model-kill-switch",
  identity: {
    provider: "openai",
    modelId: "model-kill-switch",
    status: "active",
  },
  displayName: "Kill Switch Model",
  pricing: { inPer1k: 0.002, outPer1k: 0.008, currency: "USD" },
  governance: { killSwitch: true },
  expertise: { general: 0.9 },
  reliability: 0.95,
  createdAtISO: now,
  updatedAtISO: now,
};

export const FIXTURE_MODELS: ModelRegistryEntry[] = [
  FIXTURE_MODEL_ACTIVE,
  FIXTURE_MODEL_DISABLED,
  FIXTURE_MODEL_DEPRECATED,
  FIXTURE_MODEL_PROBATION,
  FIXTURE_MODEL_TIER_CHEAP_ONLY,
  FIXTURE_MODEL_BLOCKED_TASK,
  FIXTURE_MODEL_RESTRICTED_USE,
  FIXTURE_MODEL_KILL_SWITCH,
];

export function makeObservation(
  modelId: string,
  overrides: Partial<ModelObservation> = {}
): ModelObservation {
  return {
    modelId,
    taskType: "code",
    difficulty: "medium",
    actualCostUSD: 0.01,
    predictedCostUSD: 0.01,
    actualQuality: 0.8,
    predictedQuality: 0.75,
    tsISO: now,
    ...overrides,
  };
}

export function makeObservations(
  modelId: string,
  count: number,
  base: Partial<ModelObservation> = {}
): ModelObservation[] {
  const out: ModelObservation[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      makeObservation(modelId, {
        ...base,
        actualQuality: base.actualQuality ?? 0.7 + i * 0.01,
        actualCostUSD: base.actualCostUSD ?? 0.01 * (1 + i * 0.1),
        predictedCostUSD: base.predictedCostUSD ?? 0.01,
        tsISO: new Date(Date.now() - i * 1000).toISOString(),
      })
    );
  }
  return out;
}
