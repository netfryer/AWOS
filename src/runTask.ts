/**
 * Orchestrator: route -> execute -> validate -> optional retry -> log.
 */

import { randomUUID } from "crypto";
import { route } from "./router.js";
import { appendJsonl } from "./logger.js";
import { validate } from "./validator.js";
import { getModelStatsTracker } from "./modelStats.js";
import { evaluateOutput } from "./evaluator.js";
import type { TaskCard, ModelSpec, RouterConfig } from "./types.js";
import type { Executor } from "./executor/types.js";
import type { RunLogEvent, RunAttempt } from "./runLog.js";
import type { ExecutionResult } from "./executor/types.js";
import type { ValidationResult } from "./validator.js";

const DEFAULT_LOG_PATH = "./runs/runs.jsonl";

/**
 * Build the full prompt from task metadata and optional directive.
 * When directive is provided, it is prepended as "User directive:\n{directive}\n\n".
 */
function buildPrompt(task: TaskCard, directive?: string): string {
  const directiveBlock =
    directive?.trim()
      ? `User directive:\n${directive.trim()}\n\n`
      : "";

  const parts = [
    `Task type: ${task.taskType}`,
    `Difficulty: ${task.difficulty}`,
  ];
  if (task.constraints?.minQuality != null) {
    parts.push(`Min quality: ${task.constraints.minQuality}`);
  }
  if (task.constraints?.maxCostUSD != null) {
    parts.push(`Max cost USD: ${task.constraints.maxCostUSD}`);
  }
  const taskBlock = parts.join("\n");
  return directiveBlock + taskBlock;
}

/** Compute actual cost from execution usage and model pricing. */
function computeActualCostUSD(
  execution: ExecutionResult,
  modelId: string,
  models: ModelSpec[]
): number | undefined {
  const usage = execution.usage;
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const model = models.find((m) => m.id === modelId);
  if (!model) return undefined;
  const cost =
    (inputTokens / 1000) * model.pricing.inPer1k +
    (outputTokens / 1000) * model.pricing.outPer1k;
  return cost;
}

/** Create a RunAttempt from execution and validation. */
function createRunAttempt(
  attemptNumber: number,
  modelId: string,
  prompt: string,
  execution: ExecutionResult,
  validation: ValidationResult,
  models: ModelSpec[]
): RunAttempt {
  const actualCostUSD = computeActualCostUSD(execution, modelId, models);
  return {
    attempt: attemptNumber,
    modelId,
    prompt,
    execution,
    validation,
    ...(actualCostUSD != null ? { actualCostUSD } : {}),
  };
}

/**
 * When execution fails, produce a ValidationResult without running the validator.
 */
function validationForExecutionError(execution: ExecutionResult): ValidationResult {
  const message = execution.error ?? "Unknown execution error";
  return { ok: false, reasons: [`Execution error: ${message}`] };
}

/**
 * Run a task: route, execute, validate, retry on failure if fallback available.
 * Logs one JSONL line per run with full attempts history.
 *
 * @param directive - Optional user message/directive to prepend to the prompt.
 */
export async function runTask(args: {
  task: TaskCard;
  models: ModelSpec[];
  config?: Partial<RouterConfig>;
  executor: Executor;
  logPath?: string;
  directive?: string;
}): Promise<RunLogEvent> {
  const { task, models, config, executor, logPath = DEFAULT_LOG_PATH, directive } = args;
  const runId = randomUUID();
  const ts = new Date().toISOString();

  const routing = route(task, models, config, directive);

  if (routing.status !== "ok" || routing.chosenModelId === null) {
    const event: RunLogEvent = {
      runId,
      ts,
      taskId: task.id,
      taskType: task.taskType,
      difficulty: task.difficulty,
      routing,
      expectedCostUSD: routing.expectedCostUSD,
      attempts: [],
      final: {
        status: "no_qualified_models",
        chosenModelId: null,
        retryUsed: false,
      },
    };
    await appendJsonl(logPath, event);
    await getModelStatsTracker().recordRun(event).catch((err) =>
      console.warn("ModelStatsTracker.recordRun failed:", err)
    );
    return event;
  }

  const prompt = buildPrompt(task, directive);
  const attempts: RunAttempt[] = [];

  // First attempt
  let modelId = routing.chosenModelId;
  let execution = await executor.execute({ task, modelId, prompt });
  const validation =
    execution.status === "error"
      ? validationForExecutionError(execution)
      : validate(execution.outputText, task.taskType);
  attempts.push(createRunAttempt(1, modelId, prompt, execution, validation, models));

  // Retry with fallback if execution failed OR validation failed
  const shouldRetry =
    (execution.status === "error" || !validation.ok) &&
    routing.fallbackModelIds.length >= 1;

  if (shouldRetry) {
    const fallbackId = routing.fallbackModelIds[0];
    const retryPrompt = prompt + "\nRETRY";
    execution = await executor.execute({
      task,
      modelId: fallbackId,
      prompt: retryPrompt,
    });
    const retryValidation =
      execution.status === "error"
        ? validationForExecutionError(execution)
        : validate(execution.outputText, task.taskType);
    attempts.push(
      createRunAttempt(2, fallbackId, retryPrompt, execution, retryValidation, models)
    );
  }

  const lastAttempt = attempts[attempts.length - 1];
  const finalStatus: RunLogEvent["final"]["status"] =
    lastAttempt.execution.status === "ok" && lastAttempt.validation.ok
      ? "ok"
      : "failed";
  const finalChosenModelId = lastAttempt.modelId;

  let qualityScore: number | undefined;
  if (
    finalStatus === "ok" &&
    task.difficulty !== "low"
  ) {
    try {
      const evalResult = await evaluateOutput({
        taskType: task.taskType,
        directive: directive ?? "",
        outputText: lastAttempt.execution.outputText ?? "",
      });
      qualityScore = evalResult.qualityScore;
      lastAttempt.qualityScore = qualityScore;
    } catch {
      // qualityScore stays undefined
    }
  }

  const event: RunLogEvent = {
    runId,
    ts,
    taskId: task.id,
    taskType: task.taskType,
    difficulty: task.difficulty,
    routing,
    expectedCostUSD: routing.expectedCostUSD,
    ...(lastAttempt.actualCostUSD != null ? { actualCostUSD: lastAttempt.actualCostUSD } : {}),
    ...(qualityScore != null ? { qualityScore } : {}),
    attempts,
    final: {
      status: finalStatus,
      chosenModelId: finalChosenModelId,
      retryUsed: attempts.length > 1,
    },
  };

  await appendJsonl(logPath, event);
  await getModelStatsTracker().recordRun(event).catch((err) =>
    console.warn("ModelStatsTracker.recordRun failed:", err)
  );
  return event;
}
