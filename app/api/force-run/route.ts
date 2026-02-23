import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createExecutor } from "../../../src/executor/index";
import { appendJsonl } from "../../../src/logger";
import { validate } from "../../../src/validator";
import { estimateTokensForTask } from "../../../src/router";
import { DEMO_CONFIG } from "../../../src/demoModels";
import { getModelRegistryForRuntime } from "../../../src/lib/model-hr/index";
import { evaluateWithJudge } from "../../../src/evaluator/judgeEvaluator";
import { recordEval } from "../../../src/calibration/store";
import { getModelStatsTracker } from "../../../src/modelStats";
import { getEvalSampleRateForce } from "../../../src/evalConfig";
import type { TaskCard, TaskType, Difficulty, ModelSpec } from "../../../src/types";

type Profile = "fast" | "strict" | "low_cost";

interface ForceRunRequestBody {
  message: string;
  taskType: TaskType;
  difficulty: Difficulty;
  profile: Profile;
  constraints?: { minQuality?: number; maxCostUSD?: number };
  modelId: string;
}

function computeExpectedCost(
  model: ModelSpec,
  estimatedTokens: { input: number; output: number }
): number {
  const inputCost = (estimatedTokens.input / 1000) * model.pricing.inPer1k;
  const outputCost = (estimatedTokens.output / 1000) * model.pricing.outPer1k;
  return inputCost + outputCost;
}

function buildPrompt(task: TaskCard, directive: string): string {
  const directiveBlock = directive.trim()
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
  return directiveBlock + parts.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const body: ForceRunRequestBody = await request.json();
    const { message, taskType, difficulty, profile, constraints, modelId } = body;

    if (!message || !taskType || !difficulty || !modelId) {
      return NextResponse.json(
        { error: "Missing required fields: message, taskType, difficulty, modelId" },
        { status: 400 }
      );
    }

    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const model = modelRegistry.find((m) => m.id === modelId);
    if (!model) {
      return NextResponse.json(
        { error: `Model not found: ${modelId}` },
        { status: 400 }
      );
    }

    let taskConstraints: { minQuality?: number; maxCostUSD?: number } = constraints ? { ...constraints } : {};
    if (profile === "low_cost" && taskConstraints.maxCostUSD == null) {
      taskConstraints = { ...taskConstraints, maxCostUSD: 0.01 };
    }

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
    const execution = await executor.execute({
      task,
      modelId,
      prompt,
    });

    const validation =
      execution.status === "error"
        ? { ok: false as const, reasons: [`Execution error: ${execution.error ?? "Unknown"}`] }
        : validate(execution.outputText, task.taskType);

    const runId = randomUUID();
    const ts = new Date().toISOString();
    const finalStatus = execution.status === "ok" && validation.ok ? "ok" : "failed";

    const sampleRate = getEvalSampleRateForce();
    const shouldSample = execution.status === "ok" && validation.ok && Math.random() < sampleRate;

    let evalObj: { status: "ok" | "skipped" | "error"; result?: unknown; error?: string; judgeModelId?: string; costUSD?: number } = { status: "skipped" };
    if (shouldSample) {
      try {
        const evalResponse = await evaluateWithJudge({
          taskType,
          directive: message,
          outputText: execution.outputText ?? "",
        });
        if (evalResponse.status === "ok" && evalResponse.result) {
          evalObj = {
            status: "ok",
            result: evalResponse.result,
            judgeModelId: process.env.JUDGE_MODEL_ID ?? "claude-sonnet-4-5-20250929",
            costUSD: evalResponse.costUSD,
          };
          recordEval(modelId, taskType, evalResponse.result.overall).catch((err) =>
            console.warn("Calibration recordEval failed:", err)
          );
        } else {
          evalObj = { status: "error", error: evalResponse.error ?? "Evaluator failed" };
        }
      } catch (e) {
        evalObj = { status: "error", error: e instanceof Error ? e.message : String(e) };
      }
    }

    const event = {
      runId,
      ts,
      taskId: task.id,
      taskType: task.taskType,
      difficulty: task.difficulty,
      routing: {
        chosenModelId: modelId,
        fallbackModelIds: [] as string[],
        expectedCostUSD,
        estimatedTokens,
        status: "ok" as const,
        rationale: `Forced run with model ${modelId}`,
      },
      expectedCostUSD,
      attempts: [
        {
          attempt: 1,
          modelId,
          prompt,
          execution,
          validation,
          eval: evalObj,
        },
      ],
      final: {
        status: finalStatus,
        chosenModelId: modelId,
        retryUsed: false,
      },
    };

    await appendJsonl("./runs/runs.jsonl", event);
    await getModelStatsTracker().recordRun(event).catch((err) =>
      console.warn("ModelStatsTracker.recordRun failed:", err)
    );
    return NextResponse.json(event);
  } catch (err) {
    console.error("API /api/force-run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
