import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { runTask } from "../../../src/runTask";
import { createExecutor } from "../../../src/executor/index";
import { DEMO_CONFIG } from "../../../src/demoModels";
import { getModelRegistryForRuntime } from "../../../src/lib/model-hr/index";
import { getAllComputed } from "../../../src/calibration/store";
import { applyCalibration } from "../../../src/calibration/apply";
import { getEvalSampleRateProd } from "../../../src/evalConfig";
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
  /** Override selection policy for smoke testing (bypasses ROUTER_SELECTION_POLICY env) */
  selectionPolicyOverride?: "lowest_cost_qualified" | "best_value";
  /** Override escalation policy for Stage 5 single-hop promotion */
  escalationPolicyOverride?: "off" | "promote_on_low_score";
  /** Override escalation routing mode (Stage 5.2). Requires escalationPolicyOverride=promote_on_low_score */
  escalationRoutingModeOverride?: "normal" | "escalation_aware";
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
    const body: RunRequestBody = await request.json();
    const { message, taskType, difficulty, constraints, profile = "fast", testMode = "none", selectionPolicyOverride, escalationPolicyOverride, escalationRoutingModeOverride, premiumTaskTypesOverride } = body;

    if (!message || !taskType || !difficulty) {
      return NextResponse.json(
        { error: "Missing required fields: message, taskType, difficulty" },
        { status: 400 }
      );
    }

    const selectionPolicy =
      selectionPolicyOverride ??
      (process.env.ROUTER_SELECTION_POLICY as "lowest_cost_qualified" | "best_value") ??
      "lowest_cost_qualified";
    const profileOverrides = getProfileConfigOverrides(profile);
    const config: Partial<RouterConfig> = {
      ...DEMO_CONFIG,
      ...profileOverrides,
      thresholds: { ...DEMO_CONFIG.thresholds, ...profileOverrides.thresholds },
      evaluationSampleRate: getEvalSampleRateProd(),
      selectionPolicy,
      ...(selectionPolicyOverride === "best_value"
        ? { noQualifiedPolicy: "best_value_near_threshold" as const }
        : {}),
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
              cheapFirstMaxGapByDifficulty: { low: 0.06, medium: 0.08, high: 0.1 },
              cheapFirstMinConfidence: 0.4,
              cheapFirstSavingsMinPct: 0.3,
              cheapFirstBudgetHeadroomFactor: 1.1,
              cheapFirstOnlyWhenCanPromote: true,
            },
          }
        : {}),
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
    const computed = await getAllComputed();
    const calibratedModels = applyCalibration(modelRegistry, computed);
    const calibrationConfidence =
      (selectionPolicy === "best_value" || escalationPolicyOverride === "promote_on_low_score") && computed.length > 0
        ? new Map(computed.map((c) => [`${c.modelId}|${c.taskType}`, c.confidence]))
        : undefined;
    const routingOptions = {
      ...(calibrationConfidence ? { calibrationConfidence } : {}),
      ...(config.escalation ? { escalationConfig: config.escalation } : {}),
    };
    const executor: Executor = {
      async execute(req) {
        return createExecutor(req.modelId).execute(req);
      },
    };

    const event = await runTask({
      task,
      models: calibratedModels,
      config,
      executor,
      logPath: "./runs/runs.jsonl",
      directive,
      routingOptions,
      profile,
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
