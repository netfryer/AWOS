import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { runTask } from "../../../src/runTask";
import { route } from "../../../src/router";
import { createExecutor } from "../../../src/executor/index";
import { mockExecutor } from "../../../src/executor/mockExecutor";
import { DEMO_CONFIG } from "../../../src/demoModels";
import { getModelRegistryForRuntime } from "../../../src/lib/model-hr/index";
import type { TaskCard, TaskType, Difficulty, RouterConfig } from "../../../src/types";
import type { Executor } from "../../../src/executor/types";

type Profile = "fast" | "strict" | "low_cost";

type TestMode = "none" | "uncertain" | "fail";

interface RunRequestBody {
  message: string;
  taskType: TaskType;
  difficulty: Difficulty;
  constraints?: { minQuality?: number; maxCostUSD?: number };
  profile?: Profile;
  testMode?: TestMode;
}

function getProfileConfigOverrides(profile: Profile): Partial<RouterConfig> {
  switch (profile) {
    case "fast":
      return {
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
        fallbackCount: 1,
        onBudgetFail: "best_effort_within_budget",
      };
    case "strict":
      return {
        thresholds: { low: 0.75, medium: 0.85, high: 0.92 },
        fallbackCount: 2,
        onBudgetFail: "best_effort_within_budget",
      };
    case "low_cost":
      return {
        thresholds: { low: 0.65, medium: 0.75, high: 0.85 },
        fallbackCount: 1,
        onBudgetFail: "fail",
      };
    default:
      return {};
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: RunRequestBody = await request.json();
    const { message, taskType, difficulty, constraints, profile = "fast", testMode = "none" } = body;

    if (!message || !taskType || !difficulty) {
      return NextResponse.json(
        { error: "Missing required fields: message, taskType, difficulty" },
        { status: 400 }
      );
    }

    const profileOverrides = getProfileConfigOverrides(profile);
    const config: Partial<RouterConfig> = {
      ...DEMO_CONFIG,
      ...profileOverrides,
      thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
    };

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

    let directive = message;
    if (testMode === "uncertain") directive = message + "\n__UNCERTAIN__";
    else if (testMode === "fail") directive = message + "\n__FAIL_ONCE__";

    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const routing = route(task, modelRegistry, config);
    const executor: Executor =
      routing.chosenModelId != null
        ? {
            async execute(req) {
              return createExecutor(req.modelId).execute(req);
            },
          }
        : mockExecutor;

    const event = await runTask({
      task,
      models: modelRegistry,
      config,
      executor,
      logPath: "./runs/runs.jsonl",
      directive,
    });

    if (message.trim() && event.attempts.length > 0) {
      const firstPrompt = event.attempts[0].prompt;
      if (!firstPrompt.includes("User directive:")) {
        throw new Error(
          "Sanity check failed: prompt must include 'User directive:' when a non-empty message is supplied"
        );
      }
    }

    return NextResponse.json(event);
  } catch (err) {
    console.error("API /api/run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
