import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { runTask } from "../../../../src/runTask";
import { route } from "../../../../src/router";
import { createExecutor } from "../../../../src/executor/index";
import { mockExecutor } from "../../../../src/executor/mockExecutor";
import { DEMO_CONFIG } from "../../../../src/demoModels";
import { getModelRegistryForRuntime } from "../../../../src/lib/model-hr/index";
import { getAllComputed } from "../../../../src/calibration/store";
import { applyCalibration } from "../../../../src/calibration/apply";
import { getEvalSampleRateTest } from "../../../../src/evalConfig";
import type { TaskCard, TaskType, Difficulty, RouterConfig } from "../../../../src/types";
import type { Executor } from "../../../../src/executor/types";

type Profile = "fast" | "strict" | "low_cost";

type TestMode = "none" | "fail" | "uncertain";

interface TestRunRequestBody {
  directive: string;
  taskType: TaskType;
  difficulty: "low" | "medium" | "high";
  profile: Profile;
  constraints?: { minQuality?: number; maxCostUSD?: number };
  testMode?: TestMode;
  /** Override escalation policy for Stage 5 single-hop promotion */
  escalationPolicyOverride?: "off" | "promote_on_low_score";
  /** Override escalation routing mode (Stage 5.2). Requires escalationPolicyOverride=promote_on_low_score */
  escalationRoutingModeOverride?: "normal" | "escalation_aware";
  /** Override selection policy for policy eval batch (best_value recommended) */
  selectionPolicyOverride?: "lowest_cost_qualified" | "best_value";
  /** Override cheapFirstMaxGapByDifficulty for A/B testing (e.g. { high: 0.12 }) */
  cheapFirstMaxGapOverride?: { low?: number; medium?: number; high?: number };
  /** Per-taskType gap override (writing-only experiments). E.g. { writing: { high: 0.12 } } */
  cheapFirstMaxGapOverrideByTaskType?: Partial<Record<TaskType, { low?: number; medium?: number; high?: number }>>;
  /** Per-taskType overrides for confidence and savings gates. E.g. { writing: { minConfidence: 0.25, savingsMinPct: 0.20 } } */
  cheapFirstOverridesByTaskType?: Partial<Record<TaskType, { minConfidence?: number; savingsMinPct?: number }>>;
  /** Stage 6.3: evaluationMode "focused" = cheap-first runs at cheapFirstEvalRate, others at normalEvalRate */
  escalationEvaluationModeOverride?: "uniform" | "focused";
  escalationCheapFirstEvalRateOverride?: number;
  escalationNormalEvalRateOverride?: number;
  /** Premium lanes: task types that skip cheap-first. Override for this request only. */
  premiumTaskTypesOverride?: TaskType[];
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
      escalationPolicyOverride,
      escalationRoutingModeOverride,
      selectionPolicyOverride,
      cheapFirstMaxGapOverride,
      cheapFirstMaxGapOverrideByTaskType,
      cheapFirstOverridesByTaskType,
      escalationEvaluationModeOverride,
      escalationCheapFirstEvalRateOverride,
      escalationNormalEvalRateOverride,
      premiumTaskTypesOverride,
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
    const selectionPolicy =
      selectionPolicyOverride ??
      (process.env.ROUTER_SELECTION_POLICY as "lowest_cost_qualified" | "best_value") ??
      "lowest_cost_qualified";
    const config: Partial<RouterConfig> = {
      ...DEMO_CONFIG,
      ...profileOverrides,
      thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
      evaluationSampleRate: getEvalSampleRateTest(),
      selectionPolicy,
      ...(selectionPolicy === "best_value" ? { noQualifiedPolicy: "best_value_near_threshold" as const } : {}),
      ...(premiumTaskTypesOverride != null ? { premiumTaskTypes: premiumTaskTypesOverride } : {}),
      ...(escalationPolicyOverride != null
        ? {
            escalation: {
              policy: escalationPolicyOverride,
              maxPromotions: 1,
              promotionMargin: 0.02,
              scoreResolution: 0.01,
              minScoreByDifficulty: { low: 0.7, medium: 0.8, high: 0.88 },
              requireEvalForDecision: true,
              escalateJudgeAlways: true,
              routingMode: escalationRoutingModeOverride ?? "normal",
              cheapFirstMaxGapByDifficulty: {
                low: 0.06,
                medium: 0.08,
                high: 0.1,
                ...cheapFirstMaxGapOverride,
              },
              ...(cheapFirstMaxGapOverrideByTaskType && Object.keys(cheapFirstMaxGapOverrideByTaskType).length > 0
                ? { cheapFirstMaxGapByTaskType: cheapFirstMaxGapOverrideByTaskType }
                : {}),
              ...(cheapFirstOverridesByTaskType && Object.keys(cheapFirstOverridesByTaskType).length > 0
                ? { cheapFirstOverridesByTaskType }
                : {}),
              cheapFirstMinConfidence: 0.4,
              cheapFirstSavingsMinPct: 0.3,
              cheapFirstBudgetHeadroomFactor: 1.1,
              cheapFirstOnlyWhenCanPromote: true,
              ...(escalationEvaluationModeOverride != null ? { evaluationMode: escalationEvaluationModeOverride } : {}),
              ...(escalationCheapFirstEvalRateOverride != null ? { cheapFirstEvalRate: escalationCheapFirstEvalRateOverride } : {}),
              ...(escalationNormalEvalRateOverride != null ? { normalEvalRate: escalationNormalEvalRateOverride } : {}),
            },
          }
        : {}),
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
    const computed = await getAllComputed();
    const calibratedModels = applyCalibration(modelRegistry, computed);
    const calibrationConfidence =
      (config.selectionPolicy === "best_value" || config.escalation?.policy === "promote_on_low_score") &&
      computed.length > 0
        ? new Map(computed.map((c) => [`${c.modelId}|${c.taskType}`, c.confidence]))
        : undefined;
    const routingOptions = {
      ...(calibrationConfidence ? { calibrationConfidence } : {}),
      ...(config.escalation ? { escalationConfig: config.escalation } : {}),
    };
    const routing = route(task, calibratedModels, config, directive, undefined, routingOptions);
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
      models: calibratedModels,
      config,
      executor,
      logPath: "./runs/runs.jsonl",
      routingOptions,
      directive,
      profile,
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
