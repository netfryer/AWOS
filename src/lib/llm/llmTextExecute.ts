/**
 * Minimal text execution adapter using createExecutor.
 * Returns normalized { text, usage? } for variance calibration when executors provide usage.
 */

import { createExecutor } from "../../executor/index.js";
import type { TaskType } from "../../types.js";

export interface LlmTextExecuteUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmTextExecuteResult {
  text: string;
  usage?: LlmTextExecuteUsage;
}

function normalizeUsage(raw: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): LlmTextExecuteUsage {
  const inT = raw.inputTokens ?? 0;
  const outT = raw.outputTokens ?? 0;
  const total = raw.totalTokens ?? inT + outT;
  return {
    inputTokens: inT,
    outputTokens: outT,
    totalTokens: total,
  };
}

export async function llmTextExecute(
  modelId: string,
  prompt: string
): Promise<LlmTextExecuteResult> {
  const executor = createExecutor(modelId);
  const task = {
    id: "text-exec",
    taskType: "general" as TaskType,
    difficulty: "medium" as const,
  };
  const result = await executor.execute({ task, modelId, prompt });
  if (result.status === "error") {
    throw new Error(result.error ?? "Execution failed");
  }
  const raw = result as {
    outputText?: string;
    text?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
  const text = raw.outputText ?? raw.text ?? "";
  if (raw.usage && (raw.usage.inputTokens != null || raw.usage.outputTokens != null || raw.usage.totalTokens != null)) {
    return { text, usage: normalizeUsage(raw.usage) };
  }
  return { text };
}
