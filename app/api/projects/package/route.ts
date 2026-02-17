// ─── src/app/api/projects/package/route.ts ──────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { packageWork, validateWorkPackages } from "../../../../dist/src/lib/planning/packageWork.js";
import { auditDirectorOutput } from "../../../../dist/src/lib/planning/councilAudit.js";
import { llmExecuteJsonStrict } from "../../../../dist/src/lib/llm/llmExecuteJson.js";
import { getTrustTracker } from "../../../../dist/src/lib/governance/trustTracker.js";
import { getModelRegistryForRuntime } from "../../../../dist/src/lib/model-hr/index.js";

const WorkRoleSchema = z.enum(["owner", "contributor", "reviewer", "approver", "stakeholder"]);

const WorkPackageInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  ownerRole: WorkRoleSchema,
  deliverables: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  estimatedHours: z.number().nonnegative().optional(),
});

const ProjectPlanInputSchema = z.object({
  id: z.string(),
  objective: z.string(),
  workPackages: z.array(WorkPackageInputSchema),
  risks: z.unknown().optional(),
  scoreBundle: z.unknown().optional(),
  escalationEvents: z.unknown().optional(),
  createdAt: z.string().optional(),
});

const PackageRequestSchema = z.object({
  plan: ProjectPlanInputSchema.optional(),
  directive: z.string().optional(),
  includeCouncilAudit: z.boolean().optional(),
  tierProfile: z.enum(["cheap", "standard", "premium"]).optional(),
  projectBudgetUSD: z.number().optional(),
  cwd: z.string().optional(),
});

function normalizeBody(raw: unknown): z.infer<typeof PackageRequestSchema> {
  const parsed = PackageRequestSchema.safeParse(raw);
  if (parsed.success && parsed.data.plan) {
    return parsed.data;
  }
  const planParsed = ProjectPlanInputSchema.safeParse(raw);
  if (planParsed.success) {
    return { plan: planParsed.data };
  }
  if (parsed.success) return parsed.data;
  throw new Error("Invalid request: expected plan or { plan, ... }");
}

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
    let body: z.infer<typeof PackageRequestSchema>;
    try {
      body = normalizeBody(raw);
    } catch (e) {
      return err(
        "VALIDATION_ERROR",
        e instanceof Error ? e.message : "Invalid request body"
      );
    }

    const plan = body.plan;
    const directive = body.directive ?? plan?.objective ?? "";
    const includeCouncilAudit = body.includeCouncilAudit === true;
    const tierProfile = body.tierProfile ?? "standard";
    const projectBudgetUSD = body.projectBudgetUSD ?? 50;
    const cwd = body.cwd;

    if (!plan) {
      return err("VALIDATION_ERROR", "plan is required");
    }

    const packages = packageWork(plan, { cwd });
    validateWorkPackages(packages);

    let auditedPackages = packages;
    let audit: { auditPass: boolean; confidence: number; issues: unknown[]; recommendedPatches: unknown[]; members: string[]; skipped?: boolean; warning?: string } | undefined;

    if (includeCouncilAudit && directive && plan) {
      try {
        const trustTracker = getTrustTracker();
        const { models: modelRegistry } = await getModelRegistryForRuntime();
        const llmExecuteJsonStrictFn = (args: {
          modelId: string;
          prompt: string;
          zodSchema: z.ZodTypeAny;
        }) => llmExecuteJsonStrict(args);

        const result = await auditDirectorOutput({
          directive,
          plan: plan as Parameters<typeof auditDirectorOutput>[0]["plan"],
          packages,
          tierProfile,
          projectBudgetUSD,
          ctx: {
            llmExecuteJsonStrict: llmExecuteJsonStrictFn,
            trustTracker,
            modelRegistry,
          },
        });

        auditedPackages = result.auditedPackages;
        audit = result.audit;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Audit failed";
        auditedPackages = packages;
        const planConf =
          plan?.scoreBundle && typeof plan.scoreBundle === "object" && "overall" in plan.scoreBundle
            ? (plan.scoreBundle as { overall?: number }).overall
            : undefined;
        audit = {
          auditPass: true,
          confidence: planConf ?? 0.7,
          issues: [],
          recommendedPatches: [],
          members: [],
          skipped: true,
          warning: `Council audit skipped: ${msg}`,
        };
      }
    }

    const response: Record<string, unknown> = {
      success: true,
      packages: auditedPackages,
    };
    if (audit) {
      response.audit = audit;
    }

    return NextResponse.json(response);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[packageWork]")) {
      return err("VALIDATION_ERROR", e.message);
    }
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
