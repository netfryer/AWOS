// ─── app/api/projects/run-scenario/route.ts ─────────────────────────────────
// End-to-end scenario runner: Plan → Package → Run (optional).

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { planProject } from "../../../../dist/src/lib/planning/planProject.js";
import { packageWork, validateWorkPackages } from "../../../../dist/src/lib/planning/packageWork.js";
import { auditDirectorOutput } from "../../../../dist/src/lib/planning/councilAudit.js";
import { runWorkPackages } from "../../../../dist/src/lib/execution/runWorkPackages.js";
import { createRunSession, updateRunSession } from "../../../../dist/src/lib/execution/runSessionStore.js";
import { getRunLedgerStore } from "../../../../dist/src/lib/observability/runLedger.js";
import { summarizeLedger } from "../../../../dist/src/lib/observability/analytics.js";
import { llmExecuteJsonStrict } from "../../../../dist/src/lib/llm/llmExecuteJson.js";
import { llmTextExecute } from "../../../../dist/src/lib/llm/llmTextExecute.js";
import { route } from "../../../../dist/src/router.js";
import { deterministicDecomposeDirective } from "../../../../dist/src/project/deterministicDecomposer.js";
import { getVarianceStatsTracker } from "../../../../dist/src/varianceStats.js";
import { getTrustTracker } from "../../../../dist/src/lib/governance/trustTracker.js";
import { setPortfolioMode, getPortfolioMode } from "../../../../dist/src/lib/governance/portfolioConfig.js";
import { getCachedPortfolio } from "../../../../dist/src/lib/governance/portfolioCache.js";
import type { PortfolioRecommendation } from "../../../../dist/src/lib/governance/portfolioOptimizer.js";
import { getModelRegistryForRuntime } from "../../../../dist/src/lib/model-hr/index.js";

const RunScenarioRequestSchema = z.object({
  directive: z.string().min(1),
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

    const planCtx = {
      modelRegistry,
      varianceStatsTracker: varianceTracker,
      trustTracker,
      route,
      deterministicDecomposeDirective,
      llmExecute,
    };

    const subtasks = deterministicDecomposeDirective(body.directive);
    const subtasksWithBudget = subtasks.map((s) => ({
      ...s,
      allocatedBudgetUSD: s.allocatedBudgetUSD ?? body.projectBudgetUSD / Math.max(1, subtasks.length),
    }));

    const planResult = await planProject(
      {
        directive: body.directive,
        projectBudgetUSD: body.projectBudgetUSD,
        tierProfile: body.tierProfile,
        estimateOnly: body.estimateOnly,
        difficulty: body.difficulty ?? "medium",
        subtasks: subtasksWithBudget,
      },
      planCtx
    );

    const plan = planResult.plan;
    const packages = packageWork(plan, { cwd: body.cwd });
    validateWorkPackages(packages);

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

    const ledger = ledgerStore.getLedger(runSessionId);
    const summary = ledger ? summarizeLedger(ledger) : undefined;

    const bundle: Record<string, unknown> = {
      ledger: ledger ?? null,
      summary: summary ?? null,
    };

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
      result,
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
