/**
 * Orchestrator: route -> execute -> validate -> optional retry -> optional escalation (Stage 5).
 */

import { randomUUID } from "crypto";
import { route, estimateTokensForTask, computeNormalChoice } from "./router.js";
import type { RoutingOptions } from "./router.js";
import { appendJsonl } from "./logger.js";
import { validate } from "./validator.js";
import { getModelStatsTracker } from "./modelStats.js";
import { evaluateWithJudge } from "./evaluator/judgeEvaluator.js";
import { recordEval } from "./calibration/store.js";
import { selectEscalationModel } from "./escalation/selectEscalationModel.js";
import type { TaskCard, ModelSpec, RouterConfig, EscalationConfig, Difficulty } from "./types.js";
import type { Executor } from "./executor/types.js";
import type { RunLogEvent, RunAttempt, RunAttemptEscalation } from "./runLog.js";
import type { ExecutionResult } from "./executor/types.js";
import type { ValidationResult } from "./validator.js";

const DEFAULT_LOG_PATH = "./runs/runs.jsonl";

const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  policy: "off",
  maxPromotions: 1,
  promotionMargin: 0.02,
  scoreResolution: 0.01,
  minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
  allowWhenNoQualified: true,
  requireEvalForDecision: true,
  escalateJudgeAlways: true,
};

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

/** Compute expected cost for a model given token estimates. */
function computeExpectedCostUSD(
  model: ModelSpec,
  estimatedTokens: { input: number; output: number }
): number {
  return (
    (estimatedTokens.input / 1000) * model.pricing.inPer1k +
    (estimatedTokens.output / 1000) * model.pricing.outPer1k
  );
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

/** Run evaluator and attach result to attempt. */
async function runEvaluatorAndAttach(
  attempt: RunAttempt,
  taskType: string,
  directive: string
): Promise<void> {
  const outputText = attempt.execution.outputText ?? "";
  try {
    const evalResponse = await evaluateWithJudge({
      taskType,
      directive,
      outputText,
    });
    if (evalResponse.status === "ok" && evalResponse.result) {
      attempt.eval = {
        status: "ok",
        result: evalResponse.result,
        judgeModelId: process.env.JUDGE_MODEL_ID ?? "claude-sonnet-4-5-20250929",
        costUSD: evalResponse.costUSD,
      };
    } else {
      attempt.eval = {
        status: "error",
        error: evalResponse.error ?? "Evaluator failed",
      };
    }
  } catch (e) {
    attempt.eval = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run a task: route, execute, validate, retry on failure if fallback available.
 * Stage 5: optionally escalate on low eval score (single-hop).
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
  routingOptions?: RoutingOptions;
  profile?: string;
}): Promise<RunLogEvent> {
  const { task, models, config, executor, logPath = DEFAULT_LOG_PATH, directive, routingOptions, profile = "default" } = args;
  const runId = randomUUID();
  const ts = new Date().toISOString();

  const escalation: EscalationConfig = {
    ...DEFAULT_ESCALATION_CONFIG,
    ...config?.escalation,
    minScoreByDifficulty: {
      ...DEFAULT_ESCALATION_CONFIG.minScoreByDifficulty,
      ...config?.escalation?.minScoreByDifficulty,
    },
  };

  const routing = route(task, models, config, directive, undefined, routingOptions);

  const policyEvalEnabled =
    escalation.policy === "promote_on_low_score" &&
    (routingOptions?.escalationConfig?.routingMode ?? "normal") === "escalation_aware";

  let policyEval: RunLogEvent["policyEval"] | undefined;
  if (policyEvalEnabled && routing.status === "ok" && routing.chosenModelId != null) {
    const normalChoice = computeNormalChoice(task, models, config ?? {}, directive, routingOptions);
    if (normalChoice) {
      const chosenModel = models.find((m) => m.id === routing.chosenModelId!);
      const chosenExpectedCost = routing.expectedCostUSD ?? 0;
      const escalationAware = (routing as {
        routingAudit?: {
          escalationAware?: {
            cheapFirstChoice?: unknown;
            reason?: string;
            premiumLane?: boolean;
            premiumLaneReason?: string;
            normalChoice?: { expectedCostUSD: number };
            savingsUSD?: number;
            gateRejectionCounts?: { savingsPct: number; confidence: number; gap: number; noPromotionTarget: number; budget: number };
            primaryBlocker?: string;
            gateProgress?: { initial: number; afterSavings: number; afterConfidence: number; afterGap: number; afterPromotion: number; afterBudget: number };
          };
        };
      }).routingAudit?.escalationAware;
      const isPremiumLane = !!escalationAware?.premiumLane;
      const usedCheapFirst = !isPremiumLane && !!escalationAware?.cheapFirstChoice;
      const normalExpectedCost = normalChoice.expectedCostUSD;
      const estimatedSavingsUSD = usedCheapFirst ? Math.max(0, normalExpectedCost - chosenExpectedCost) : 0;
      const estimatedSavingsPct = normalExpectedCost > 0 ? estimatedSavingsUSD / normalExpectedCost : 0;

      policyEval = {
        enabled: true,
        selectionPolicy: (config?.selectionPolicy ?? "lowest_cost_qualified") as "lowest_cost_qualified" | "best_value",
        routingMode: "escalation_aware",
        taskType: task.taskType,
        difficulty: task.difficulty,
        profile,
        normalChoice: {
          modelId: normalChoice.modelId,
          expectedCostUSD: normalChoice.expectedCostUSD,
          threshold: normalChoice.threshold,
          expertise: normalChoice.expertise,
          ...(normalChoice.rawConfidence != null ? { rawConfidence: normalChoice.rawConfidence } : {}),
          ...(normalChoice.rationale ? { rationale: normalChoice.rationale } : {}),
        },
        chosenAttempt1: {
          modelId: routing.chosenModelId,
          expectedCostUSD: chosenExpectedCost,
          expertise: chosenModel ? (chosenModel.expertise[task.taskType] ?? 0) : 0,
          ...(routingOptions?.calibrationConfidence?.get(`${routing.chosenModelId}|${task.taskType}`) != null
            ? { rawConfidence: routingOptions.calibrationConfidence.get(`${routing.chosenModelId}|${task.taskType}`)! }
            : {}),
        },
        usedCheapFirst,
        estimatedSavingsUSD,
        estimatedSavingsPct,
        ...(isPremiumLane
          ? { premiumLane: true, premiumTaskType: task.taskType, gateReason: "premium_lane", primaryBlocker: "premium_lane" as const }
          : {}),
        ...(escalationAware?.cheapFirstChoice && typeof escalationAware.cheapFirstChoice === "object" && escalationAware.cheapFirstChoice !== null && "promotionTargetId" in escalationAware.cheapFirstChoice
          ? { promotionTargetId: (escalationAware.cheapFirstChoice as { promotionTargetId?: string }).promotionTargetId }
          : {}),
        ...(escalationAware?.cheapFirstChoice && typeof escalationAware.cheapFirstChoice === "object" && escalationAware.cheapFirstChoice !== null && "worstCaseExpectedCostUSD" in escalationAware.cheapFirstChoice
          ? { worstCaseExpectedCostUSD: (escalationAware.cheapFirstChoice as { worstCaseExpectedCostUSD?: number }).worstCaseExpectedCostUSD }
          : {}),
        ...(!usedCheapFirst && !isPremiumLane && escalationAware?.reason ? { gateReason: escalationAware.reason } : {}),
        ...(!usedCheapFirst && !isPremiumLane && escalationAware?.gateRejectionCounts ? { gateRejectionCounts: escalationAware.gateRejectionCounts } : {}),
        ...(!usedCheapFirst && !isPremiumLane && escalationAware?.primaryBlocker
          ? {
              primaryBlocker: escalationAware.primaryBlocker as
                | "savingsPct"
                | "confidence"
                | "gap"
                | "noPromotionTarget"
                | "budget"
                | "no_cheap_first_candidates",
            }
          : {}),
        ...(!usedCheapFirst && !isPremiumLane && escalationAware?.gateProgress ? { gateProgress: escalationAware.gateProgress } : {}),
        result: {
          escalationUsed: false,
          finalModelId: routing.chosenModelId,
        },
      };
    }
  }

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
  let finalChosenModelId = lastAttempt.modelId;

  const usedCheapFirst = !!(
    (routing as { routingAudit?: { escalationAware?: { cheapFirstChoice?: unknown } } }).routingAudit?.escalationAware
      ?.cheapFirstChoice
  );
  const evalRate =
    escalation.evaluationMode === "focused"
      ? usedCheapFirst
        ? (escalation.cheapFirstEvalRate ?? 1.0)
        : (escalation.normalEvalRate ?? 0.25)
      : (config?.evaluationSampleRate ?? 0.25);
  const shouldSample =
    lastAttempt.execution.status === "ok" &&
    lastAttempt.validation.ok &&
    Math.random() < evalRate;

  if (!shouldSample) {
    lastAttempt.eval = { status: "skipped" };
  } else {
    await runEvaluatorAndAttach(lastAttempt, task.taskType, directive ?? "");
  }

  if (lastAttempt.eval?.status === "ok" && lastAttempt.eval.result?.overall != null) {
    recordEval(lastAttempt.modelId, task.taskType, lastAttempt.eval.result.overall).catch((err) =>
      console.warn("Calibration recordEval failed:", err)
    );
  }

  let escalationUsed = false;
  let escalationDecision: RunLogEvent["final"]["escalationDecision"] | undefined;

  // Stage 5: Escalation when eval below threshold (maxPromotions=1 enforced)
  const maxPromotions = Math.min(1, escalation.maxPromotions ?? 1);
  if (
    escalation.policy === "promote_on_low_score" &&
    finalStatus === "ok" &&
    maxPromotions >= 1
  ) {
    const requireEval = escalation.requireEvalForDecision ?? true;
    const promotionMargin = escalation.promotionMargin ?? 0.02;
    const scoreResolution = escalation.scoreResolution ?? 0.01;
    const roundScore = (x: number) => Math.round(x / scoreResolution) * scoreResolution;
    const targetScore =
      escalation.minScoreByTaskType?.[task.taskType]?.[task.difficulty] ??
      escalation.minScoreByDifficulty[task.difficulty as Difficulty];
    const effectiveThreshold = targetScore - promotionMargin;

    let initialScore: number | undefined;
    if (lastAttempt.eval?.status === "ok" && lastAttempt.eval.result?.overall != null) {
      initialScore = lastAttempt.eval.result.overall;
    } else if (requireEval) {
      await runEvaluatorAndAttach(lastAttempt, task.taskType, directive ?? "");
      if (lastAttempt.eval?.status === "ok" && lastAttempt.eval.result?.overall != null) {
        initialScore = lastAttempt.eval.result.overall;
      }
    }

    if (initialScore != null && roundScore(initialScore) < roundScore(effectiveThreshold)) {
      const { modelId: escalationModelId, reason } = selectEscalationModel({
        taskType: task.taskType,
        currentModelId: lastAttempt.modelId,
        availableModelIds: models.map((m) => m.id),
        orderByTaskType: escalation.escalationModelOrderByTaskType,
      });

      if (escalationModelId) {
        const escalationModel = models.find((m) => m.id === escalationModelId);
        if (escalationModel) {
          const estimatedTokens = estimateTokensForTask(task, directive, config);
          const incrementalExpectedCostUSD = computeExpectedCostUSD(escalationModel, estimatedTokens);
          const actualCostSoFar = lastAttempt.actualCostUSD ?? 0;
          const budget = task.constraints?.maxCostUSD;
          const maxExtra = escalation.maxExtraCostUSD;

          const budgetOk =
            (budget == null || actualCostSoFar + incrementalExpectedCostUSD <= budget) &&
            (maxExtra == null || incrementalExpectedCostUSD <= maxExtra);

          if (budgetOk) {
            const escalationPrompt = prompt;
            const escalationExecution = await executor.execute({
              task,
              modelId: escalationModelId,
              prompt: escalationPrompt,
            });
            const escalationValidation =
              escalationExecution.status === "error"
                ? validationForExecutionError(escalationExecution)
                : validate(escalationExecution.outputText ?? "", task.taskType);

            const escalationAttempt = createRunAttempt(
              attempts.length + 1,
              escalationModelId,
              escalationPrompt,
              escalationExecution,
              escalationValidation,
              models
            );

            if (
              escalationExecution.status === "ok" &&
              escalationValidation.ok &&
              (escalation.escalateJudgeAlways ?? true)
            ) {
              await runEvaluatorAndAttach(escalationAttempt, task.taskType, directive ?? "");
            }

            if (escalationAttempt.eval?.status === "ok" && escalationAttempt.eval.result?.overall != null) {
              recordEval(escalationAttempt.modelId, task.taskType, escalationAttempt.eval.result.overall).catch(
                (err) => console.warn("Calibration recordEval failed:", err)
              );
            }

            const escalationScore =
              escalationAttempt.eval?.status === "ok" && escalationAttempt.eval.result?.overall != null
                ? escalationAttempt.eval.result.overall
                : undefined;
            const initialCost = lastAttempt.actualCostUSD ?? Infinity;
            const escalatedCost = escalationAttempt.actualCostUSD ?? Infinity;

            let chosenAttempt: "initial" | "escalated";
            let chosenScore: number;
            if (
              escalationAttempt.execution.status === "ok" &&
              escalationAttempt.validation.ok &&
              escalationScore != null
            ) {
              if (lastAttempt.eval?.status === "ok" && lastAttempt.eval.result?.overall != null) {
                const rEsc = roundScore(escalationScore);
                const rInit = roundScore(initialScore!);
                if (rEsc > rInit) {
                  chosenAttempt = "escalated";
                  chosenScore = escalationScore;
                } else if (rEsc < rInit) {
                  chosenAttempt = "initial";
                  chosenScore = initialScore!;
                } else {
                  chosenAttempt = escalatedCost < initialCost ? "escalated" : "initial";
                  chosenScore = escalationScore;
                }
              } else {
                chosenAttempt = "escalated";
                chosenScore = escalationScore;
              }
            } else {
              chosenAttempt = "initial";
              chosenScore = initialScore!;
            }

            const escalationMeta: RunAttemptEscalation = {
              promotedFromModelId: lastAttempt.modelId,
              promotedToModelId: escalationModelId,
              reason: "eval_below_threshold",
              threshold: targetScore,
              initialScore: initialScore!,
              chosenScore,
              chosenAttempt,
              incrementalExpectedCostUSD,
              incrementalActualCostUSD: escalationAttempt.actualCostUSD,
            };
            escalationAttempt.escalation = escalationMeta;

            attempts.push(escalationAttempt);
            escalationUsed = true;
            finalChosenModelId = chosenAttempt === "escalated" ? escalationModelId : lastAttempt.modelId;
            const shortId = (id: string) => id.replace(/^gpt-/, "");
            const chosenLabel = chosenAttempt === "escalated" ? " (chosen)" : " (kept initial)";
            const summary = `Escalation: ${shortId(lastAttempt.modelId)} ${initialScore!.toFixed(2)} < ${targetScore.toFixed(2)} → promoted to ${shortId(escalationModelId)} ${(escalationScore ?? 0).toFixed(2)}${chosenLabel}`;
            escalationDecision = {
              initialScore: initialScore!,
              threshold: targetScore,
              escalatedScore: escalationScore,
              chosenAttempt,
              reason: escalationMeta.reason,
              summary,
            };
          }
        }
      }
    }
  }

  const chosenAttemptData =
    escalationUsed && escalationDecision?.chosenAttempt === "escalated"
      ? attempts[attempts.length - 1]
      : lastAttempt;
  const qualityScore =
    chosenAttemptData.eval?.result?.overall ?? chosenAttemptData.qualityScore;

  if (policyEval) {
    const targetScore =
      escalation.minScoreByTaskType?.[task.taskType]?.[task.difficulty] ??
      escalation.minScoreByDifficulty[task.difficulty as Difficulty];
    const promotionMargin = escalation.promotionMargin ?? 0.02;
    const effectiveThreshold = targetScore - promotionMargin;
    const realizedAttempt1CostUSD = attempts[0]?.actualCostUSD;
    const realizedTotalCostUSD = attempts.reduce((sum, a) => sum + (a.actualCostUSD ?? 0), 0);
    const initialScore =
      lastAttempt.eval?.status === "ok" && lastAttempt.eval?.result?.overall != null
        ? lastAttempt.eval.result.overall
        : undefined;

    policyEval.result = {
      escalationUsed,
      finalModelId: finalChosenModelId ?? routing.chosenModelId ?? "",
      ...(initialScore != null ? { initialScore } : {}),
      ...(qualityScore != null ? { finalScore: qualityScore } : {}),
      ...(targetScore != null ? { targetScore } : {}),
      effectiveThreshold,
      ...(realizedAttempt1CostUSD != null ? { realizedAttempt1CostUSD } : {}),
      ...(realizedTotalCostUSD > 0 ? { realizedTotalCostUSD } : {}),
    };
  }

  const event: RunLogEvent = {
    runId,
    ts,
    taskId: task.id,
    taskType: task.taskType,
    difficulty: task.difficulty,
    routing,
    expectedCostUSD: routing.expectedCostUSD,
    ...(chosenAttemptData.actualCostUSD != null ? { actualCostUSD: chosenAttemptData.actualCostUSD } : {}),
    ...(qualityScore != null ? { qualityScore } : {}),
    attempts,
    ...(policyEval ? { policyEval } : {}),
    final: {
      status: finalStatus,
      chosenModelId: finalChosenModelId,
      retryUsed: shouldRetry,
      ...(escalationUsed ? { escalationUsed: true, escalationDecision } : {}),
    },
  };

  await appendJsonl(logPath, event);
  await getModelStatsTracker().recordRun(event).catch((err) =>
    console.warn("ModelStatsTracker.recordRun failed:", err)
  );
  return event;
}
