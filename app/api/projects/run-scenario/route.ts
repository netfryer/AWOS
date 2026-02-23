// ─── app/api/projects/run-scenario/route.ts ─────────────────────────────────
// End-to-end scenario runner: Plan → Package → Run (optional).

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { planProject } from "../../../../src/lib/planning/planProject";
import { packageWork, validateWorkPackages } from "../../../../src/lib/planning/packageWork";
import { auditDirectorOutput } from "../../../../src/lib/planning/councilAudit";
import { runWorkPackages } from "../../../../src/lib/execution/runWorkPackages";
import { createRunSession, updateRunSession } from "../../../../src/lib/execution/runSessionStore";
import { getRunLedgerStore } from "../../../../src/lib/observability/runLedger";
import { summarizeLedger } from "../../../../src/lib/observability/analytics";
import { llmExecuteJsonStrict } from "../../../../src/lib/llm/llmExecuteJson";
import { llmTextExecute } from "../../../../src/lib/llm/llmTextExecute";
import { route } from "../../../../src/router";
import { deterministicDecomposeDirective } from "../../../../src/project/deterministicDecomposer";
import { getVarianceStatsTracker } from "../../../../src/varianceStats";
import { getTrustTracker } from "../../../../src/lib/governance/trustTracker";
import { setPortfolioMode, getPortfolioMode } from "../../../../src/lib/governance/portfolioConfig";
import { getCachedPortfolio } from "../../../../src/lib/governance/portfolioCache";
import type { PortfolioRecommendation } from "../../../../src/lib/governance/portfolioOptimizer";
import { getModelRegistryForRuntime } from "../../../../src/lib/model-hr/index";
import {
  CSV_JSON_CLI_DEMO_PACKAGES,
  CSV_JSON_CLI_DEMO_DIRECTIVE,
} from "../../../../src/lib/execution/presets/csvJsonCliDemo";
import { saveDemoRun, extractDeliverablesFromRuns } from "../../../lib/demoRunsStore";
import { runCEONode } from "../../../../src/lib/rbeg";
import type { RoleExecutionRecord } from "../../../../src/lib/observability/runLedger";

const PRESETS: Record<string, { packages: import("../../../../src/lib/planning/packageWork").AtomicWorkPackage[]; directive: string }> = {
  "csv-json-cli-demo": { packages: CSV_JSON_CLI_DEMO_PACKAGES, directive: CSV_JSON_CLI_DEMO_DIRECTIVE },
};

const RunScenarioRequestSchema = z.object({
  directive: z.string().optional(),
  presetId: z.string().optional(),
  projectBudgetUSD: z.number().positive(),
  tierProfile: z.enum(["cheap", "standard", "premium"]),
  difficulty: z.enum(["low", "medium", "high"]).optional(),
  estimateOnly: z.boolean().default(false),
  includeCouncilAudit: z.boolean().default(false),
  includeCouncilDebug: z.boolean().default(false),
  portfolioMode: z.enum(["off", "prefer", "lock"]).optional(),
  concurrency: z.object({
    worker: z.number().int().positive().optional(),
    qa: z.number().int().positive().optional(),
  }).optional(),
  async: z.boolean().default(true),
  cwd: z.string().optional(),
  trust: z.boolean().optional(),
  variance: z.boolean().optional(),
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

function validatePortfolioCoverage(
  portfolio: PortfolioRecommendation,
  modelRegistry: { id: string }[]
): { valid: boolean; missingIds: string[] } {
  const registryIds = new Set(modelRegistry.map((m) => m.id));
  const slotIds = [
    portfolio.portfolio.workerCheap,
    portfolio.portfolio.workerImplementation,
    portfolio.portfolio.workerStrategy,
    portfolio.portfolio.qaPrimary,
    portfolio.portfolio.qaBackup,
  ].filter(Boolean);
  const missingIds = slotIds.filter((id) => !registryIds.has(id));
  return { valid: missingIds.length === 0, missingIds };
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    if (raw == null || typeof raw !== "object") {
      return err("VALIDATION_ERROR", "Request body must be a JSON object");
    }
    const parsed = RunScenarioRequestSchema.safeParse(raw);
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

    if (body.directive == null && body.presetId == null) {
      return err("VALIDATION_ERROR", "Either directive or presetId must be provided");
    }
    if (body.presetId != null && !PRESETS[body.presetId]) {
      return err("VALIDATION_ERROR", `Unknown presetId: ${body.presetId}. Available: ${Object.keys(PRESETS).join(", ")}`);
    }

    if (body.portfolioMode != null) {
      setPortfolioMode(body.portfolioMode);
    }

    const varianceTracker = getVarianceStatsTracker();
    const trustTracker = getTrustTracker();
    const ledgerStore = getRunLedgerStore();
    const { models: modelRegistry } = await getModelRegistryForRuntime();

    const llmExecute = async (
      modelId: string,
      prompt: string,
      jsonSchema: z.ZodType
    ) => llmExecuteJsonStrict({ modelId, prompt, zodSchema: jsonSchema });

    let plan: import("../../../../src/lib/schemas/governance").ProjectPlan | undefined;
    let packages: import("../../../../src/lib/planning/packageWork").AtomicWorkPackage[];
    const directive = body.presetId
      ? PRESETS[body.presetId].directive
      : (body.directive as string);

    const difficulty = body.difficulty ?? "medium";
    runCEONode(directive, body.projectBudgetUSD, difficulty);
    const ceoRoleExec: RoleExecutionRecord = { nodeId: "ceo", role: "ceo", status: "ok", costUSD: 0 };
    const managerRoleExec: RoleExecutionRecord = { nodeId: "manager", role: "manager", status: "ok", costUSD: 0 };

    if (body.presetId) {
      packages = [...PRESETS[body.presetId].packages];
      plan = {
        id: randomUUID(),
        objective: directive,
        workPackages: packages.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          ownerRole: "owner" as const,
          deliverables: [p.description ?? p.name],
          dependencies: p.dependencies,
        })),
      };
    } else {
      const planCtx = {
        modelRegistry,
        varianceStatsTracker: varianceTracker,
        trustTracker,
        route,
        deterministicDecomposeDirective,
        llmExecute,
      };

      const subtasks = deterministicDecomposeDirective(directive);
      const subtasksWithBudget = subtasks.map((s) => ({
        ...s,
        allocatedBudgetUSD: s.allocatedBudgetUSD ?? body.projectBudgetUSD / Math.max(1, subtasks.length),
      }));

      const planResult = await planProject(
        {
          directive,
          projectBudgetUSD: body.projectBudgetUSD,
          tierProfile: body.tierProfile,
          estimateOnly: body.estimateOnly,
          difficulty: body.difficulty ?? "medium",
          subtasks: subtasksWithBudget,
        },
        planCtx
      );

      plan = planResult.plan;
      packages = packageWork(plan, { cwd: body.cwd });
    }

    let auditedPackages = packages;
    let audit: { auditPass: boolean; confidence: number; issues: unknown[]; recommendedPatches: unknown[]; members: string[]; skipped?: boolean; warning?: string } | undefined;

    if (body.includeCouncilAudit && body.directive && plan) {
      try {
        const llmExecuteJsonStrictFn = (args: {
          modelId: string;
          prompt: string;
          zodSchema: z.ZodTypeAny;
        }) => llmExecuteJsonStrict(args);

        const auditResult = await auditDirectorOutput({
          directive: body.directive,
          plan: plan as Parameters<typeof auditDirectorOutput>[0]["plan"],
          packages,
          tierProfile: body.tierProfile,
          projectBudgetUSD: body.projectBudgetUSD,
          ctx: {
            llmExecuteJsonStrict: llmExecuteJsonStrictFn,
            trustTracker,
            modelRegistry,
          },
        });

        auditedPackages = auditResult.auditedPackages;
        audit = auditResult.audit;
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

    if (body.estimateOnly) {
      return NextResponse.json({
        success: true,
        estimateOnly: true,
        plan,
        packages: auditedPackages,
        ...(audit && { audit }),
      });
    }

    const workerCount = auditedPackages.filter((p: { role: string }) => p.role === "Worker").length;
    const qaCount = auditedPackages.filter((p: { role: string }) => p.role === "QA").length;
    const runSessionId = randomUUID();

    createRunSession({
      id: runSessionId,
      progress: {
        totalPackages: auditedPackages.length,
        completedPackages: 0,
        runningPackages: 0,
        warnings: [],
      },
    });

    ledgerStore.createLedger(runSessionId, {
      counts: { packagesTotal: auditedPackages.length, worker: workerCount, qa: qaCount },
    });

    try {
      validateWorkPackages(auditedPackages);
    } catch (validationErr) {
      const msg = validationErr instanceof Error ? validationErr.message : String(validationErr);
      const managerRoleExecFail: RoleExecutionRecord = {
        nodeId: "manager",
        role: "manager",
        status: "fail",
        costUSD: 0,
        notes: msg.slice(0, 200),
      };
      ledgerStore.finalizeLedger(runSessionId, {
        roleExecutions: [ceoRoleExec, managerRoleExecFail],
      });
      return err("VALIDATION_ERROR", `Manager output validation failed: ${msg}`, { reason: msg });
    }

    const portfolioMode = getPortfolioMode();
    let portfolio: PortfolioRecommendation | undefined;
    let effectiveMode = portfolioMode;

    if (portfolioMode === "prefer" || portfolioMode === "lock") {
      portfolio = await getCachedPortfolio(
        {
          modelRegistry,
          trustTracker,
          varianceStatsTracker: varianceTracker,
        },
        60,
        false
      ).catch(() => undefined);

      if (portfolio) {
        const { valid, missingIds } = validatePortfolioCoverage(portfolio, modelRegistry);
        if (!valid) {
          effectiveMode = "off";
          portfolio = undefined;
          ledgerStore.recordBudgetOptimization(runSessionId, {
            portfolioValidationFailed: true,
            reason: "portfolio_coverage_invalid",
            missingModelIds: missingIds,
          });
        }
      }
    }

    const runCtx = {
      route,
      modelRegistry,
      varianceStatsTracker: varianceTracker,
      trustTracker,
      llmTextExecute,
      nowISO: () => new Date().toISOString(),
      runSessionId,
      ledger: ledgerStore,
      portfolioMode: effectiveMode,
      portfolio,
    };

    const runInput = {
      packages: auditedPackages,
      projectBudgetUSD: body.projectBudgetUSD,
      tierProfile: body.tierProfile,
      ctx: runCtx,
      concurrency: body.concurrency,
    };

    if (body.async) {
      Promise.resolve()
        .then(async () => {
          try {
            const result = await runWorkPackages(runInput);
            ledgerStore.finalizeLedger(runSessionId, {
              completed: result.runs.length + result.qaResults.length,
            });
            updateRunSession(runSessionId, {
              status: "completed",
              progress: {
                totalPackages: auditedPackages.length,
                completedPackages: result.runs.length + result.qaResults.length,
                runningPackages: 0,
                warnings: result.warnings,
                partialResult: result,
              },
            });
            const asyncLedger = ledgerStore.getLedger(runSessionId);
            const asyncSummary = asyncLedger ? summarizeLedger(asyncLedger) : undefined;
            const deliverables = extractDeliverablesFromRuns(result.runs);
            await saveDemoRun(runSessionId, {
              runSessionId,
              timestamp: new Date().toISOString(),
              plan,
              packages: auditedPackages,
              result: { runs: result.runs, qaResults: result.qaResults, escalations: result.escalations, budget: result.budget, warnings: result.warnings },
              deliverables: Object.keys(deliverables).length > 0 ? deliverables : undefined,
              bundle: { ledger: asyncLedger ?? undefined, summary: asyncSummary ?? undefined },
            });
          } catch (e) {
            ledgerStore.finalizeLedger(runSessionId);
            updateRunSession(runSessionId, {
              status: "failed",
              progress: {
                totalPackages: auditedPackages.length,
                completedPackages: 0,
                runningPackages: 0,
                warnings: [e instanceof Error ? e.message : String(e)],
              },
            });
          }
        })
        .catch(() => {});

      return NextResponse.json({
        success: true,
        runSessionId,
        plan,
        packages: auditedPackages,
        ...(audit && { audit }),
        async: true,
        estimateOnly: false,
      });
    }

    const result = await runWorkPackages(runInput);
    const fullRoleExecutions: RoleExecutionRecord[] = [
      ceoRoleExec,
      managerRoleExec,
      ...result.roleExecutions,
    ];
    ledgerStore.finalizeLedger(runSessionId, {
      completed: result.runs.length + result.qaResults.length,
      roleExecutions: fullRoleExecutions,
    });

    const resultWithRoleExecutions = { ...result, roleExecutions: fullRoleExecutions };
    updateRunSession(runSessionId, {
      status: "completed",
      progress: {
        totalPackages: auditedPackages.length,
        completedPackages: result.runs.length + result.qaResults.length,
        runningPackages: 0,
        warnings: result.warnings,
        partialResult: resultWithRoleExecutions,
      },
    });

    const ledger = ledgerStore.getLedger(runSessionId);
    const summary = ledger ? summarizeLedger(ledger) : undefined;

    const bundle: Record<string, unknown> = {
      ledger: ledger ?? null,
      summary: summary ?? null,
    };

    const deliverables = extractDeliverablesFromRuns(result.runs);
    await saveDemoRun(runSessionId, {
      runSessionId,
      timestamp: new Date().toISOString(),
      plan,
      packages: auditedPackages,
      result: { runs: result.runs, qaResults: result.qaResults, escalations: result.escalations, budget: result.budget, warnings: result.warnings, roleExecutions: fullRoleExecutions },
      deliverables: Object.keys(deliverables).length > 0 ? deliverables : undefined,
      bundle: { ledger: ledger ?? undefined, summary: summary ?? undefined },
    });

    if (body.trust !== false) {
      const trust = trustTracker.getTrustMap();
      if (Object.keys(trust).length > 0) {
        bundle.trust = trust;
      }
    }

    if (body.variance !== false) {
      const stats = await varianceTracker.getStats();
      bundle.variance = stats;
    }

    return NextResponse.json({
      success: true,
      runSessionId,
      plan,
      packages: auditedPackages,
      ...(audit && { audit }),
      result: resultWithRoleExecutions,
      bundle,
      async: false,
      estimateOnly: false,
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[packageWork]")) {
      return err("VALIDATION_ERROR", e.message);
    }
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
