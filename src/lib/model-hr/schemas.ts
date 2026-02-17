/**
 * Zod schemas for Model HR registry validation.
 * Used to validate models.json entries; invalid entries are skipped with warnings.
 * Allows passthrough of unknown fields for forward/backward compatibility.
 */

import { z } from "zod";

export const ModelStatusSchema = z.enum(["active", "probation", "deprecated", "disabled"]);
export type ModelStatusSchemaType = z.infer<typeof ModelStatusSchema>;

export const ModelIdentitySchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    aliases: z.array(z.string()).optional(),
    version: z.string().optional(),
    status: ModelStatusSchema,
    releasedAtISO: z.string().optional(),
    deprecatedAtISO: z.string().optional(),
    disabledAtISO: z.string().optional(),
    disabledReason: z.string().optional(),
  })
  .passthrough();

export const ModelPricingSchema = z
  .object({
    inPer1k: z.number().nonnegative(),
    outPer1k: z.number().nonnegative(),
    currency: z.string().default("USD"),
    minimumChargeUSD: z.number().nonnegative().optional(),
    roundingRule: z.enum(["perToken", "per1k", "perRequest"]).optional(),
  })
  .passthrough();

export const EligibilityRuleSchema = z
  .object({
    condition: z.enum(["always", "whenBudgetAbove", "whenImportanceBelow"]),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const CanaryThresholdsSchema = z
  .object({
    probationQuality: z.number().optional(),
    graduateQuality: z.number().optional(),
    probationFailCount: z.number().optional(),
  })
  .passthrough();

export const ModelGovernanceSchema = z
  .object({
    allowedTiers: z.array(z.enum(["cheap", "standard", "premium"])).optional(),
    defaultTierProfile: z.enum(["cheap", "standard", "premium"]).optional(),
    eligibilityRules: z.array(EligibilityRuleSchema).optional(),
    blockedProviders: z.array(z.string()).optional(),
    blockedTaskTypes: z.array(z.string()).optional(),
    killSwitch: z.boolean().optional(),
    maxCostVarianceRatio: z.number().optional(),
    minQualityPrior: z.number().optional(),
    maxRecentEscalations: z.number().optional(),
    disableAutoDisable: z.boolean().optional(),
    canaryThresholds: CanaryThresholdsSchema.optional(),
  })
  .passthrough();

export const ModelCapabilitiesSchema = z
  .object({
    modalities: z.array(z.enum(["text", "image", "audio", "vision"])).optional(),
    toolUse: z.boolean().optional(),
    jsonReliability: z.enum(["native", "prompted", "unreliable"]).optional(),
    contextWindowTokens: z.number().optional(),
    functionCalling: z.boolean().optional(),
    streaming: z.boolean().optional(),
    reasoning: z.boolean().optional(),
  })
  .passthrough();

export const ModelGuardrailsSchema = z
  .object({
    safetyCategory: z.enum(["standard", "high", "restricted"]).optional(),
    highRiskFlag: z.boolean().optional(),
    restrictedUseCases: z.array(z.string()).optional(),
    complianceTags: z.array(z.string()).optional(),
  })
  .passthrough();

export const ModelOperationalSchema = z
  .object({
    rateLimitRPM: z.number().optional(),
    rateLimitTPM: z.number().optional(),
    latencySLOms: z.number().optional(),
    stability: z.enum(["stable", "beta", "experimental"]).optional(),
    regions: z.array(z.string()).optional(),
  })
  .passthrough();

export const ModelPerformancePriorSchema = z
  .object({
    taskType: z.string(),
    difficulty: z.string(),
    qualityPrior: z.number(),
    costMultiplier: z.number(),
    calibrationConfidence: z.number(),
    varianceBandLow: z.number().optional(),
    varianceBandHigh: z.number().optional(),
    lastUpdatedISO: z.string(),
    sampleCount: z.number(),
    defectRate: z.number().optional(),
  })
  .passthrough();

export const ModelEvaluationMetaSchema = z
  .object({
    lastBenchmarkISO: z.string().optional(),
    canaryStatus: z.enum(["none", "running", "passed", "failed"]).optional(),
    regressionIndicators: z.array(z.string()).optional(),
  })
  .passthrough();

export const ModelRegistryEntrySchema = z
  .object({
    id: z.string().min(1),
    identity: ModelIdentitySchema,
    displayName: z.string().optional(),
    pricing: ModelPricingSchema,
    expertise: z.record(z.string(), z.number()).optional(),
    reliability: z.number().min(0).max(1).optional(),
    capabilities: ModelCapabilitiesSchema.optional(),
    guardrails: ModelGuardrailsSchema.optional(),
    operational: ModelOperationalSchema.optional(),
    performancePriors: z.array(ModelPerformancePriorSchema).optional(),
    governance: ModelGovernanceSchema.optional(),
    evaluationMeta: ModelEvaluationMetaSchema.optional(),
    createdAtISO: z.string().min(1),
    updatedAtISO: z.string().min(1),
  })
  .passthrough();

export type ModelRegistryEntrySchemaType = z.infer<typeof ModelRegistryEntrySchema>;
