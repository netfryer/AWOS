/**
 * Scoring module: singleton service and public API.
 */

import type { ModelRegistryEntry, ModelScoreContext, ModelScoreBreakdown } from "../types.js";
import type { ModelPerformancePrior } from "../types.js";
import { ScoreService } from "./scoreService.js";
import { makeFileRegistryService } from "../registry/index.js";

let singleton: ScoreService | null = null;

function makeScoreService(): ScoreService {
  if (singleton) return singleton;
  const registry = makeFileRegistryService();
  singleton = new ScoreService(registry);
  return singleton;
}

export { makeScoreService, ScoreService };

export async function computeModelScore(
  model: ModelRegistryEntry,
  ctx: ModelScoreContext
): Promise<number> {
  return makeScoreService().computeModelScore(model, ctx);
}

export async function computeModelScoreWithBreakdown(
  model: ModelRegistryEntry,
  ctx: ModelScoreContext
): Promise<{ score: number; breakdown: ModelScoreBreakdown }> {
  return makeScoreService().computeModelScoreWithBreakdown(model, ctx);
}

export async function getPrior(
  model: ModelRegistryEntry,
  taskType: string,
  difficulty: string
): Promise<ModelPerformancePrior | null> {
  return makeScoreService().getPrior(model, taskType, difficulty);
}
