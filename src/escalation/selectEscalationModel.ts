/**
 * Selects the next-tier model for escalation when eval score is below threshold.
 * Stage 5: single-hop promotion only.
 */

import type { TaskType } from "../types.js";

/** Default tier order by task type (cheapest first, strongest last) */
const DEFAULT_ORDER_BY_TASK_TYPE: Record<TaskType, string[]> = {
  code: ["gpt-4o-mini", "claude-sonnet-4-5-20250929", "gpt-4o"],
  writing: ["gpt-4o-mini", "claude-sonnet-4-5-20250929", "gpt-4o"],
  analysis: ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4-5-20250929"],
  general: ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4-5-20250929"],
};

export interface SelectEscalationModelParams {
  taskType: TaskType;
  currentModelId: string;
  availableModelIds: string[];
  orderByTaskType?: Partial<Record<TaskType, string[]>>;
}

export interface SelectEscalationModelResult {
  modelId: string | null;
  reason: string;
}

/**
 * Selects the next-tier model for escalation.
 * - Uses orderByTaskType[taskType] if provided, else default.
 * - Finds currentModelId position; picks next model in list that exists in availableModelIds.
 * - If currentModelId not in list, picks first model after cheapest tier (second element) that exists.
 * - Returns null if no higher tier is available.
 */
export function selectEscalationModel({
  taskType,
  currentModelId,
  availableModelIds,
  orderByTaskType,
}: SelectEscalationModelParams): SelectEscalationModelResult {
  const order = orderByTaskType?.[taskType] ?? DEFAULT_ORDER_BY_TASK_TYPE[taskType];
  const availableSet = new Set(availableModelIds);
  const idx = order.indexOf(currentModelId);

  if (idx >= 0) {
    for (let i = idx + 1; i < order.length; i++) {
      if (availableSet.has(order[i])) {
        return {
          modelId: order[i],
          reason: `next_tier_after_${currentModelId}`,
        };
      }
    }
    return {
      modelId: null,
      reason: "no_higher_tier_available",
    };
  }

  // currentModelId not in list: pick first model after cheapest tier (second element) that exists
  const startIdx = Math.min(1, order.length - 1);
  for (let i = startIdx; i < order.length; i++) {
    if (availableSet.has(order[i]) && order[i] !== currentModelId) {
      return {
        modelId: order[i],
        reason: `first_tier_above_cheapest_after_${currentModelId}`,
      };
    }
  }
  return {
    modelId: null,
    reason: "no_higher_tier_available",
  };
}
