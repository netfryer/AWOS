/**
 * Policy service: deterministic eligibility decisions with disqualification reasons.
 */

import type { ModelGovernance, ModelGuardrails, ModelRegistryEntry } from "../types.js";
import type { RegistryService } from "../registry/registryService.js";

export type DisqualificationReason =
  | "disabled"
  | "kill_switch"
  | "deprecated"
  | "tier_not_allowed"
  | "provider_blocked"
  | "task_type_blocked"
  | "budget_too_low"
  | "importance_too_low"
  | "restricted_use_case";

export interface EligibilityContext {
  tierProfile: "cheap" | "standard" | "premium";
  taskType: string;
  difficulty: string;
  budgetRemainingUSD: number;
  importance?: number;
  useCaseTags?: string[];
  /** Optional: block models from these providers */
  blockedProviders?: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: DisqualificationReason;
  detail?: string;
}

export class PolicyService {
  constructor(private registry: RegistryService) {}

  isEligible(model: ModelRegistryEntry, ctx: EligibilityContext): EligibilityResult {
    if (model.identity.status === "disabled") {
      return {
        eligible: false,
        reason: "disabled",
        detail: model.identity.disabledReason ?? "Model is disabled",
      };
    }

    if (model.governance?.killSwitch === true) {
      return {
        eligible: false,
        reason: "kill_switch",
        detail: "Model kill switch is enabled",
      };
    }

    if (model.identity.status === "deprecated") {
      return {
        eligible: true,
        detail: "Model is deprecated; consider migrating",
      };
    }

    const allowedTiers = model.governance?.allowedTiers;
    if (allowedTiers != null && allowedTiers.length > 0 && !allowedTiers.includes(ctx.tierProfile)) {
      return {
        eligible: false,
        reason: "tier_not_allowed",
        detail: `Tier ${ctx.tierProfile} not in allowedTiers [${allowedTiers.join(", ")}]`,
      };
    }

    if (ctx.blockedProviders?.includes(model.identity.provider)) {
      return {
        eligible: false,
        reason: "provider_blocked",
        detail: `Provider ${model.identity.provider} is blocked`,
      };
    }

    const blockedTaskTypes = model.governance?.blockedTaskTypes;
    if (blockedTaskTypes?.includes(ctx.taskType)) {
      return {
        eligible: false,
        reason: "task_type_blocked",
        detail: `Task type ${ctx.taskType} is blocked for this model`,
      };
    }

    const restrictedUseCases = model.guardrails?.restrictedUseCases;
    if (
      restrictedUseCases != null &&
      restrictedUseCases.length > 0 &&
      ctx.useCaseTags != null &&
      ctx.useCaseTags.length > 0
    ) {
      const overlap = restrictedUseCases.some((r) => ctx.useCaseTags!.includes(r));
      if (overlap) {
        return {
          eligible: false,
          reason: "restricted_use_case",
          detail: `Use case tag conflicts with restrictedUseCases`,
        };
      }
    }

    if (
      model.guardrails?.safetyCategory === "restricted" &&
      ctx.tierProfile === "cheap"
    ) {
      return {
        eligible: false,
        reason: "restricted_use_case",
        detail: "Safety category restricted requires standard or premium tier",
      };
    }

    const rules = model.governance?.eligibilityRules;
    if (rules != null && rules.length > 0) {
      for (const rule of rules) {
        if (rule.condition === "whenBudgetAbove") {
          const minUSD = rule.params?.minUSD as number | undefined;
          if (typeof minUSD === "number" && ctx.budgetRemainingUSD < minUSD) {
            return {
              eligible: false,
              reason: "budget_too_low",
              detail: `Budget $${ctx.budgetRemainingUSD.toFixed(4)} below min $${minUSD.toFixed(4)}`,
            };
          }
        }
        if (rule.condition === "whenImportanceBelow") {
          const maxImportance = rule.params?.maxImportance as number | undefined;
          if (typeof maxImportance === "number" && ctx.importance != null && ctx.importance > maxImportance) {
            return {
              eligible: false,
              reason: "importance_too_low",
              detail: `Importance ${ctx.importance} exceeds max ${maxImportance} for this model`,
            };
          }
        }
      }
    }

    return { eligible: true };
  }

  async listEligibleModels(
    ctx: EligibilityContext
  ): Promise<{
    eligible: ModelRegistryEntry[];
    ineligible: Array<{ model: ModelRegistryEntry; result: EligibilityResult }>;
  }> {
    const models = await this.registry.listModels({ includeDisabled: true });
    const eligible: ModelRegistryEntry[] = [];
    const ineligible: Array<{ model: ModelRegistryEntry; result: EligibilityResult }> = [];

    for (const model of models) {
      const result = this.isEligible(model, ctx);
      if (result.eligible) {
        eligible.push(model);
      } else {
        ineligible.push({ model, result });
      }
    }

    return { eligible, ineligible };
  }
}
