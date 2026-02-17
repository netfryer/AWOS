/**
 * Zod schema for ProviderModel validation.
 * Shared by adapters and sync logic.
 */

import { z } from "zod";

export const PricingSchema = z.object({
  inPer1k: z.number().nonnegative(),
  outPer1k: z.number().nonnegative(),
  currency: z.string().default("USD"),
  minimumChargeUSD: z.number().nonnegative().optional(),
  roundingRule: z.enum(["perToken", "per1k", "perRequest"]).optional(),
});

export const ProviderModelSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  pricing: PricingSchema,
  allowedTiers: z.array(z.enum(["cheap", "standard", "premium"])).optional(),
  expertise: z.record(z.string(), z.number().min(0).max(1)).optional(),
  reliability: z.number().min(0).max(1).optional(),
  aliases: z.array(z.string()).optional(),
});

export const ProviderConfigSchema = z.object({
  provider: z.string().min(1),
  models: z.array(ProviderModelSchema),
});

export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
