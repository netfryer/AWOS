// ─── src/app/api/projects/plan/route.ts ───────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { planProject } from "../../../../src/lib/planning/planProject";
import { llmExecuteJsonStrict } from "../../../../src/lib/llm/llmExecuteJson";
import { route } from "../../../../src/router";
import { deterministicDecomposeDirective } from "../../../../src/project/deterministicDecomposer";
import { getVarianceStatsTracker } from "../../../../src/varianceStats";
import { getTrustTracker } from "../../../../src/lib/governance/trustTracker";
import { getModelRegistryForRuntime } from "../../../../src/lib/model-hr/index";

const ProjectSubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  taskType: z.enum(["code", "writing", "analysis", "general"]),
  difficulty: z.enum(["low", "medium", "high"]),
  importance: z.number(),
  recommendedTier: z.enum(["cheap", "standard", "premium"]).optional(),
  allocatedBudgetUSD: z.number().optional(),
});

const PlanRequestSchema = z.object({
  directive: z.string().min(1),
  projectBudgetUSD: z.number().positive(),
  tierProfile: z.string().optional(),
  estimateOnly: z.boolean(),
  difficulty: z.enum(["low", "medium", "high"]).optional(),
  subtasks: z.array(ProjectSubtaskSchema).optional(),
  includeCouncilDebug: z.boolean().optional(),
});

function err(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 400 }
  );
}

function err500(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const parsed = PlanRequestSchema.safeParse(raw);
    if (!parsed.success) {
      let details: unknown;
      try {
        const errObj = parsed.error as { issues?: unknown[]; message?: string };
        details = Array.isArray(errObj?.issues)
          ? errObj.issues.map((i: unknown) => {
              const item = i as { path?: unknown[]; message?: string };
              return { path: item.path ?? [], message: item.message ?? "invalid" };
            })
          : errObj?.message ?? "Validation failed";
      } catch {
        details = "Validation failed";
      }
      return err("VALIDATION_ERROR", "Invalid request body", details);
    }
    const body = parsed.data;

    const varianceTracker = getVarianceStatsTracker();
    const trustTracker = getTrustTracker();
    const { models: modelRegistry } = await getModelRegistryForRuntime();

    const llmExecute = async (
      modelId: string,
      prompt: string,
      jsonSchema: z.ZodType
    ) => llmExecuteJsonStrict({ modelId, prompt, zodSchema: jsonSchema });

    const ctx = {
      modelRegistry,
      varianceStatsTracker: varianceTracker,
      trustTracker,
      route,
      deterministicDecomposeDirective,
      llmExecute,
    };

    const subtasks = body.subtasks ?? deterministicDecomposeDirective(body.directive);
    const subtasksWithBudget = subtasks.map((s) => ({
      ...s,
      allocatedBudgetUSD: s.allocatedBudgetUSD ?? body.projectBudgetUSD / Math.max(1, subtasks.length),
    }));

    const result = await planProject(
      {
        directive: body.directive,
        projectBudgetUSD: body.projectBudgetUSD,
        tierProfile: body.tierProfile,
        estimateOnly: body.estimateOnly,
        difficulty: body.difficulty,
        subtasks: subtasksWithBudget,
      },
      ctx
    );

    const response: Record<string, unknown> = {
      success: true,
      plan: result.plan,
      underfunded: result.underfunded,
      budgetWarnings: result.budgetWarnings,
    };
    if (body.includeCouncilDebug && result.councilDebug) {
      response.councilDebug = result.councilDebug;
    }

    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
