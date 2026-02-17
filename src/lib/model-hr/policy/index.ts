/**
 * Policy module: singleton service and public API.
 */

import type { ModelRegistryEntry } from "../types.js";
import type { EligibilityContext, EligibilityResult } from "./policyService.js";
import { PolicyService } from "./policyService.js";
import { makeFileRegistryService } from "../registry/index.js";

let singleton: PolicyService | null = null;

function makePolicyService(): PolicyService {
  if (singleton) return singleton;
  const registry = makeFileRegistryService();
  singleton = new PolicyService(registry);
  return singleton;
}

export { makePolicyService, PolicyService };
export type {
  DisqualificationReason,
  EligibilityContext,
  EligibilityResult,
} from "./policyService.js";

export async function listEligibleModels(ctx: EligibilityContext): Promise<{
  eligible: ModelRegistryEntry[];
  ineligible: Array<{ model: ModelRegistryEntry; result: EligibilityResult }>;
}> {
  return makePolicyService().listEligibleModels(ctx);
}
