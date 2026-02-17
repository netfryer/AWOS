import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { runTask } from "../../../../dist/src/runTask.js";
import { route } from "../../../../dist/src/router.js";
import { createExecutor } from "../../../../dist/src/executor/index.js";
import { mockExecutor } from "../../../../dist/src/executor/mockExecutor.js";
import { DEMO_CONFIG } from "../../../../dist/src/demoModels.js";
import { getModelRegistryForRuntime } from "../../../../dist/src/lib/model-hr/index.js";
import type { TaskCard, TaskType, Difficulty, RouterConfig } from "../../../../dist/src/types.js";
import type { Executor } from "../../../../dist/src/executor/types.js";

type Profile = "fast" | "strict" | "low_cost";

type TestMode = "none" | "fail" | "uncertain";

interface TestRunRequestBody {
  directive: string;
  taskType: TaskType;
  difficulty: "low" | "medium" | "high";
  profile: Profile;
  constraints?: { minQuality?: number; maxCostUSD?: number };
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
    const body: TestRunRequestBody = await request.json();
    const {
      directive: rawDirective,
      taskType,
      difficulty,
      profile = "fast",
      constraints,
      testMode = "none",
    } = body;

    if (
      rawDirective === undefined ||
      rawDirective === null ||
      !taskType ||
      !difficulty
    ) {
      return NextResponse.json(
        { error: "Missing required fields: directive, taskType, difficulty" },
        { status: 400 }
      );
    }

    const profileOverrides = getProfileConfigOverrides(profile);
    const config: Partial<RouterConfig> = {
      ...DEMO_CONFIG,
      ...profileOverrides,
      thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
    };

    let taskConstraints: { minQuality?: number; maxCostUSD?: number } =
      constraints ? { ...constraints } : {};
    if (profile === "low_cost" && taskConstraints.maxCostUSD == null) {
      taskConstraints = { ...taskConstraints, maxCostUSD: 0.01 };
    }

    const task: TaskCard = {
      id: `task-${randomUUID().slice(0, 8)}`,
      taskType,
      difficulty,
      constraints:
        Object.keys(taskConstraints).length > 0 ? taskConstraints : undefined,
    };

    let directive = String(rawDirective);
    if (testMode === "fail") directive = directive + "\n__FAIL_ONCE__";
    else if (testMode === "uncertain") directive = directive + "\n__UNCERTAIN__";

    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const routing = route(task, modelRegistry, config, directive);
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

    return NextResponse.json(event);
  } catch (err) {
    console.error("API /api/test/run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
