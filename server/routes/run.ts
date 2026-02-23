import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { runTask } from "../../src/runTask.js";
import { createExecutor } from "../../src/executor/index.js";
import { mockExecutor } from "../../src/executor/mockExecutor.js";
import { appendJsonl } from "../../src/logger.js";
import { validate } from "../../src/validator.js";
import { estimateTokensForTask, route } from "../../src/router.js";
import { evaluateWithJudge } from "../../src/evaluator/judgeEvaluator.js";
import { recordEval } from "../../src/calibration/store.js";
import { getModelStatsTracker } from "../../src/modelStats.js";
import { DEMO_CONFIG } from "../../src/demoModels.js";
import { getModelRegistryForRuntime } from "../../src/lib/model-hr/index.js";
import { getAllComputed } from "../../src/calibration/store.js";
import { applyCalibration } from "../../src/calibration/apply.js";
import { getEvalSampleRateProd, getEvalSampleRateForce, getEvalSampleRateTest } from "../../src/evalConfig.js";
import type { TaskCard, TaskType, Difficulty, RouterConfig, ModelSpec } from "../../src/types.js";
import type { Executor, ExecutionRequest } from "../../src/executor/types.js";
import type { RunLogEvent } from "../../src/runLog.js";

type Profile = "fast" | "strict" | "low_cost";
type TestMode = "none" | "uncertain" | "fail";

function getProfileConfigOverrides(profile: Profile): Partial<RouterConfig> {
  switch (profile) {
    case "fast":
      return { thresholds: { low: 0.65, medium: 0.75, high: 0.85 }, fallbackCount: 1, onBudgetFail: "best_effort_within_budget" };
    case "strict":
      return { thresholds: { low: 0.75, medium: 0.85, high: 0.92 }, fallbackCount: 2, onBudgetFail: "best_effort_within_budget" };
    case "low_cost":
      return { thresholds: { low: 0.65, medium: 0.75, high: 0.85 }, fallbackCount: 1, onBudgetFail: "fail" };
    default:
      return {};
  }
}

export async function runPost(req: Request, res: Response) {
  try {
    const body = req.body as {
      message: string;
      taskType: TaskType;
      difficulty: Difficulty;
      constraints?: { minQuality?: number; maxCostUSD?: number };
      profile?: Profile;
      testMode?: TestMode;
      selectionPolicyOverride?: "lowest_cost_qualified" | "best_value";
      escalationPolicyOverride?: "off" | "promote_on_low_score";
      escalationRoutingModeOverride?: "normal" | "escalation_aware";
      premiumTaskTypesOverride?: TaskType[];
    };
    const { message, taskType, difficulty, constraints, profile = "fast", testMode = "none", selectionPolicyOverride, escalationPolicyOverride, escalationRoutingModeOverride, premiumTaskTypesOverride } = body;
    if (!message || !taskType || !difficulty) {
      return res.status(400).json({ error: "Missing required fields: message, taskType, difficulty" });
    }
    const selectionPolicy = selectionPolicyOverride ?? (process.env.ROUTER_SELECTION_POLICY as "lowest_cost_qualified" | "best_value") ?? "lowest_cost_qualified";
    const profileOverrides = getProfileConfigOverrides(profile);
    const config: Partial<RouterConfig> = {
      ...DEMO_CONFIG,
      ...profileOverrides,
      thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
      evaluationSampleRate: getEvalSampleRateProd(),
      selectionPolicy,
      ...(selectionPolicyOverride === "best_value" ? { noQualifiedPolicy: "best_value_near_threshold" as const } : {}),
      ...(premiumTaskTypesOverride != null ? { premiumTaskTypes: premiumTaskTypesOverride } : {}),
      ...(escalationPolicyOverride != null ? {
        escalation: {
          policy: escalationPolicyOverride,
          maxPromotions: 1,
          promotionMargin: 0.02,
          scoreResolution: 0.01,
          minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
          requireEvalForDecision: true,
          escalateJudgeAlways: true,
          routingMode: escalationRoutingModeOverride ?? "normal",
          cheapFirstMaxGapByDifficulty: { low: 0.06, medium: 0.08, high: 0.1 },
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.3,
          cheapFirstBudgetHeadroomFactor: 1.1,
          cheapFirstOnlyWhenCanPromote: true,
        },
      } : {}),
    };
    let taskConstraints = constraints ? { ...constraints } : {};
    if (profile === "low_cost" && taskConstraints.maxCostUSD == null) taskConstraints = { ...taskConstraints, maxCostUSD: 0.01 };
    const task: TaskCard = {
      id: `task-${randomUUID().slice(0, 8)}`,
      taskType,
      difficulty,
      constraints: Object.keys(taskConstraints).length > 0 ? taskConstraints : undefined,
    };
    let directive = message;
    if (testMode === "uncertain") directive = message + "\n__UNCERTAIN__";
    else if (testMode === "fail") directive = message + "\n__FAIL_ONCE__";
    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const computed = await getAllComputed();
    const calibratedModels = applyCalibration(modelRegistry, computed);
    const calibrationConfidence = (selectionPolicy === "best_value" || escalationPolicyOverride === "promote_on_low_score") && computed.length > 0
      ? new Map(computed.map((c) => [`${c.modelId}|${c.taskType}`, c.confidence])) : undefined;
    const routingOptions = { ...(calibrationConfidence ? { calibrationConfidence } : {}), ...(config.escalation ? { escalationConfig: config.escalation } : {}) };
    const executor: Executor = { async execute(req) { return createExecutor(req.modelId).execute(req); } };
    const event = await runTask({ task, models: calibratedModels, config, executor, logPath: "./runs/runs.jsonl", directive, routingOptions, profile });
    res.json(event);
  } catch (err) {
    console.error("API /api/run error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}

function computeExpectedCost(model: ModelSpec, estimatedTokens: { input: number; output: number }): number {
  const inputCost = (estimatedTokens.input / 1000) * model.pricing.inPer1k;
  const outputCost = (estimatedTokens.output / 1000) * model.pricing.outPer1k;
  return inputCost + outputCost;
}

function buildPrompt(task: TaskCard, directive: string): string {
  const directiveBlock = directive.trim() ? `User directive:\n${directive.trim()}\n\n` : "";
  const parts = [`Task type: ${task.taskType}`, `Difficulty: ${task.difficulty}`];
  if (task.constraints?.minQuality != null) parts.push(`Min quality: ${task.constraints.minQuality}`);
  if (task.constraints?.maxCostUSD != null) parts.push(`Max cost USD: ${task.constraints.maxCostUSD}`);
  return directiveBlock + parts.join("\n");
}

export async function forceRunPost(req: Request, res: Response) {
  try {
    const body = req.body as { message: string; taskType: TaskType; difficulty: Difficulty; profile: Profile; constraints?: { minQuality?: number; maxCostUSD?: number }; modelId: string };
    const { message, taskType, difficulty, profile, constraints, modelId } = body;
    if (!message || !taskType || !difficulty || !modelId) {
      return res.status(400).json({ error: "Missing required fields: message, taskType, difficulty, modelId" });
    }
    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const model = modelRegistry.find((m) => m.id === modelId);
    if (!model) return res.status(400).json({ error: `Model not found: ${modelId}` });
    let taskConstraints = constraints ? { ...constraints } : {};
    if (profile === "low_cost" && taskConstraints.maxCostUSD == null) taskConstraints = { ...taskConstraints, maxCostUSD: 0.01 };
    const task: TaskCard = {
      id: `task-${randomUUID().slice(0, 8)}`,
      taskType,
      difficulty,
      constraints: Object.keys(taskConstraints).length > 0 ? taskConstraints : undefined,
    };
    const estimatedTokens = estimateTokensForTask(task, message, DEMO_CONFIG);
    const expectedCostUSD = computeExpectedCost(model, estimatedTokens);
    const prompt = buildPrompt(task, message);
    const executor = createExecutor(modelId);
    const execution = await executor.execute({ task, modelId, prompt });
    const validation = execution.status === "error"
      ? { ok: false as const, reasons: [`Execution error: ${execution.error ?? "Unknown"}`] }
      : validate(execution.outputText, task.taskType);
    const runId = randomUUID();
    const finalStatus = execution.status === "ok" && validation.ok ? "ok" : "failed";
    const sampleRate = getEvalSampleRateForce();
    const shouldSample = execution.status === "ok" && validation.ok && Math.random() < sampleRate;
    let evalObj: { status: "ok" | "skipped" | "error"; result?: unknown; error?: string; judgeModelId?: string; costUSD?: number } = { status: "skipped" };
    if (shouldSample) {
      try {
        const evalResponse = await evaluateWithJudge({ taskType, directive: message, outputText: execution.outputText ?? "" });
        if (evalResponse.status === "ok" && evalResponse.result) {
          evalObj = { status: "ok", result: evalResponse.result, judgeModelId: process.env.JUDGE_MODEL_ID ?? "claude-sonnet-4-5-20250929", costUSD: evalResponse.costUSD };
          recordEval(modelId, taskType, evalResponse.result.overall).catch((err) => console.warn("Calibration recordEval failed:", err));
        } else evalObj = { status: "error", error: evalResponse.error ?? "Evaluator failed" };
      } catch (e) {
        evalObj = { status: "error", error: e instanceof Error ? e.message : String(e) };
      }
    }
    const event: RunLogEvent = {
      runId,
      ts: new Date().toISOString(),
      taskId: task.id,
      taskType: task.taskType,
      difficulty: task.difficulty,
      routing: { chosenModelId: modelId, fallbackModelIds: [] as string[], expectedCostUSD, estimatedTokens, status: "ok" as const, rationale: `Forced run with model ${modelId}` },
      expectedCostUSD,
      attempts: [{ attempt: 1, modelId, prompt, execution, validation, eval: evalObj as RunLogEvent["attempts"][0]["eval"] }],
      final: { status: finalStatus, chosenModelId: modelId, retryUsed: false },
    };
    await appendJsonl("./runs/runs.jsonl", event);
    await getModelStatsTracker().recordRun(event).catch((err) => console.warn("ModelStatsTracker.recordRun failed:", err));
    res.json(event);
  } catch (err) {
    console.error("API /api/force-run error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}

export async function testRunPost(req: Request, res: Response) {
  try {
    const body = req.body as {
      directive: string;
      taskType: TaskType;
      difficulty: "low" | "medium" | "high";
      profile?: Profile;
      constraints?: { minQuality?: number; maxCostUSD?: number };
      testMode?: "none" | "fail" | "uncertain";
      escalationPolicyOverride?: "off" | "promote_on_low_score";
      escalationRoutingModeOverride?: "normal" | "escalation_aware";
      selectionPolicyOverride?: "lowest_cost_qualified" | "best_value";
      premiumTaskTypesOverride?: TaskType[];
    };
    const { directive: rawDirective, taskType, difficulty, profile = "fast", constraints, testMode = "none", escalationPolicyOverride, escalationRoutingModeOverride, selectionPolicyOverride, premiumTaskTypesOverride } = body;
    if (rawDirective === undefined || rawDirective === null || !taskType || !difficulty) {
      return res.status(400).json({ error: "Missing required fields: directive, taskType, difficulty" });
    }
    const profileOverrides = getProfileConfigOverrides(profile);
    const selectionPolicy = selectionPolicyOverride ?? (process.env.ROUTER_SELECTION_POLICY as "lowest_cost_qualified" | "best_value") ?? "lowest_cost_qualified";
    const config: Partial<RouterConfig> = {
      ...DEMO_CONFIG,
      ...profileOverrides,
      thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
      evaluationSampleRate: getEvalSampleRateTest(),
      selectionPolicy,
      ...(selectionPolicy === "best_value" ? { noQualifiedPolicy: "best_value_near_threshold" as const } : {}),
      ...(premiumTaskTypesOverride != null ? { premiumTaskTypes: premiumTaskTypesOverride } : {}),
      ...(escalationPolicyOverride != null ? {
        escalation: {
          policy: escalationPolicyOverride,
          maxPromotions: 1,
          promotionMargin: 0.02,
          scoreResolution: 0.01,
          minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
          requireEvalForDecision: true,
          escalateJudgeAlways: true,
          routingMode: escalationRoutingModeOverride ?? "normal",
          cheapFirstMaxGapByDifficulty: { low: 0.06, medium: 0.08, high: 0.1 },
          cheapFirstMinConfidence: 0.4,
          cheapFirstSavingsMinPct: 0.3,
          cheapFirstBudgetHeadroomFactor: 1.1,
          cheapFirstOnlyWhenCanPromote: true,
        },
      } : {}),
    };
    let taskConstraints = constraints ? { ...constraints } : {};
    if (profile === "low_cost" && taskConstraints.maxCostUSD == null) taskConstraints = { ...taskConstraints, maxCostUSD: 0.01 };
    const task: TaskCard = {
      id: `task-${randomUUID().slice(0, 8)}`,
      taskType,
      difficulty,
      constraints: Object.keys(taskConstraints).length > 0 ? taskConstraints : undefined,
    };
    let directive = String(rawDirective);
    if (testMode === "fail") directive = directive + "\n__FAIL_ONCE__";
    else if (testMode === "uncertain") directive = directive + "\n__UNCERTAIN__";
    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const computed = await getAllComputed();
    const calibratedModels = applyCalibration(modelRegistry, computed);
    const calibrationConfidence = (config.selectionPolicy === "best_value" || config.escalation?.policy === "promote_on_low_score") && computed.length > 0
      ? new Map(computed.map((c) => [`${c.modelId}|${c.taskType}`, c.confidence])) : undefined;
    const routingOptions = { ...(calibrationConfidence ? { calibrationConfidence } : {}), ...(config.escalation ? { escalationConfig: config.escalation } : {}) };
    const routing = route(task, calibratedModels, config, directive, undefined, routingOptions);
    const executor: Executor =
      routing.chosenModelId != null
        ? {
            async execute(req: ExecutionRequest) {
              return createExecutor(req.modelId).execute(req);
            },
          }
        : mockExecutor;
    const event = await runTask({ task, models: calibratedModels, config, executor: executor as Executor, logPath: "./runs/runs.jsonl", routingOptions, directive, profile });
    res.json(event);
  } catch (err) {
    console.error("API /api/test/run error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
