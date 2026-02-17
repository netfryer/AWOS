/**
 * Adapters: ModelRegistryEntry -> ModelSpec for router integration.
 */

import type { ModelSpec, TaskType } from "../../types.js";
import type { ModelRegistryEntry } from "./types.js";

const TASK_TYPES: TaskType[] = ["code", "writing", "analysis", "general"];

export function mapRegistryEntryToModelSpec(entry: ModelRegistryEntry): ModelSpec {
  const expertise: Record<TaskType, number> = {} as Record<TaskType, number>;
  for (const tt of TASK_TYPES) {
    expertise[tt] = entry.expertise?.[tt] ?? entry.expertise?.general ?? 0.7;
  }
  return {
    id: entry.id,
    displayName: entry.displayName ?? entry.id,
    expertise,
    pricing: {
      inPer1k: entry.pricing.inPer1k,
      outPer1k: entry.pricing.outPer1k,
    },
    reliability: entry.reliability ?? 0.7,
  };
}
