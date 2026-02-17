/**
 * Evaluation module: singleton service and public API.
 */

import type { ModelObservation } from "../types.js";
import type { ModelPerformancePrior } from "../types.js";
import { EvaluationService } from "./evaluationService.js";
import { makeFileRegistryService } from "../registry/index.js";

let singleton: EvaluationService | null = null;

function makeEvaluationService(): EvaluationService {
  if (singleton) return singleton;
  const registry = makeFileRegistryService();
  singleton = new EvaluationService(registry);
  return singleton;
}

export { makeEvaluationService, EvaluationService };

export async function recordObservation(obs: ModelObservation): Promise<void> {
  return makeEvaluationService().recordObservation(obs);
}

export async function updatePriorsForObservation(
  obs: ModelObservation
): Promise<ModelPerformancePrior | null> {
  return makeEvaluationService().updatePriorsForObservation(obs);
}
