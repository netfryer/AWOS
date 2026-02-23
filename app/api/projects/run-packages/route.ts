// ─── src/app/api/projects/run-packages/route.ts ────────────────────────────

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runWorkPackages } from "../../../../src/lib/execution/runWorkPackages";
import { createRunSession, updateRunSession } from "../../../../src/lib/execution/runSessionStore";
import { getRunLedgerStore } from "../../../../src/lib/observability/runLedger";
import { route } from "../../../../src/router";
import { getPortfolioMode } from "../../../../src/lib/governance/portfolioConfig";
import { getCachedPortfolio } from "../../../../src/lib/governance/portfolioCache";
import type { PortfolioRecommendation } from "../../../../src/lib/governance/portfolioOptimizer";
import { getVarianceStatsTracker } from "../../../../src/varianceStats";
import { getTrustTracker } from "../../../../src/lib/governance/trustTracker";
import { llmTextExecute } from "../../../../src/lib/llm/llmTextExecute";
import { getModelRegistryForRuntime } from "../../../../src/lib/model-hr/index";
import { saveDemoRun, extractDeliverablesFromRuns } from "../../../lib/demoRunsStore";

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

const AtomicWorkPackageSchema = z.object({
  id: z.string(),
  role: z.enum(["Worker", "QA"]),
  name: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  dependencies: z.array(z.string()),
  estimatedTokens: z.number().nonnegative(),
  tierProfileOverride: z.enum(["cheap", "standard", "premium"]).optional(),
  cheapestViableChosen: z.boolean().optional(),
});

const RunPackagesRequestSchema = z.object({
  packages: z.array(AtomicWorkPackageSchema),
  projectBudgetUSD: z.number().positive(),
  tierProfile: z.enum(["cheap", "standard", "premium"]),
  concurrency: z.object({
    worker: z.number().int().positive().optional(),
    qa: z.number().int().positive().optional(),
  }).optional(),
  cheapestViableChosen: z.boolean().optional(),
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
    if (raw == null || typeof raw !== "object") {
      return err("VALIDATION_ERROR", "Request body must be a JSON object");
    }
    const parsed = RunPackagesRequestSchema.safeParse(raw);
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

    const asyncMode = request.nextUrl?.searchParams?.get("async") === "true";

    const varianceTracker = getVarianceStatsTracker();
    const trustTracker = getTrustTracker();
    const ledgerStore = getRunLedgerStore();
    const { models: modelRegistry } = await getModelRegistryForRuntime();

    const workerCount = body.packages.filter((p: { role: string }) => p.role === "Worker").length;
    const qaCount = body.packages.filter((p: { role: string }) => p.role === "QA").length;

    if (asyncMode) {
      const runSessionId = createRunSession({
        progress: {
          totalPackages: body.packages.length,
          completedPackages: 0,
          runningPackages: 0,
          warnings: [],
        },
      });

      ledgerStore.createLedger(runSessionId, {
        counts: { packagesTotal: body.packages.length, worker: workerCount, qa: qaCount },
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

      const ctx = {
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
        packages: body.packages,
        projectBudgetUSD: body.projectBudgetUSD,
        tierProfile: body.tierProfile,
        ctx,
        concurrency: body.concurrency,
        cheapestViableChosen: body.cheapestViableChosen,
      };

      Promise.resolve()
        .then(async () => {
          try {
            const result = await runWorkPackages(runInput);
            ledgerStore.finalizeLedger(runSessionId, {
              completed: result.runs.length + result.qaResults.length,
              roleExecutions: result.roleExecutions,
            });
            updateRunSession(runSessionId, {
              status: "completed",
              progress: {
                totalPackages: body.packages.length,
                completedPackages: result.runs.length + result.qaResults.length,
                runningPackages: 0,
                warnings: result.warnings,
                partialResult: result,
              },
            });
            const deliverables = extractDeliverablesFromRuns(result.runs);
            await saveDemoRun(runSessionId, {
              runSessionId,
              timestamp: new Date().toISOString(),
              packages: body.packages,
              result: {
                runs: result.runs,
                qaResults: result.qaResults,
                escalations: result.escalations,
                budget: result.budget,
                warnings: result.warnings,
                roleExecutions: result.roleExecutions,
              },
              deliverables: Object.keys(deliverables).length > 0 ? deliverables : undefined,
              bundle: {
                ledger: ledgerStore.getLedger(runSessionId) ?? undefined,
              },
            });
          } catch (e) {
            ledgerStore.finalizeLedger(runSessionId);
            updateRunSession(runSessionId, {
              status: "failed",
              progress: {
                totalPackages: body.packages.length,
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
      });
    }

    const runSessionId = randomUUID();
    ledgerStore.createLedger(runSessionId, {
      counts: { packagesTotal: body.packages.length, worker: workerCount, qa: qaCount },
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

    const ctx = {
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
      packages: body.packages,
      projectBudgetUSD: body.projectBudgetUSD,
      tierProfile: body.tierProfile,
      ctx,
      concurrency: body.concurrency,
      cheapestViableChosen: body.cheapestViableChosen,
    };

    const result = await runWorkPackages(runInput);
    ledgerStore.finalizeLedger(runSessionId, {
      completed: result.runs.length + result.qaResults.length,
      roleExecutions: result.roleExecutions,
    });
    // Create run session for sync so run-session returns result (run detail page)
    createRunSession({
      id: runSessionId,
      status: "completed",
      progress: {
        totalPackages: body.packages.length,
        completedPackages: result.runs.length + result.qaResults.length,
        runningPackages: 0,
        warnings: result.warnings,
        partialResult: result,
      },
    });
    const deliverables = extractDeliverablesFromRuns(result.runs);
    await saveDemoRun(runSessionId, {
      runSessionId,
      timestamp: new Date().toISOString(),
      packages: body.packages,
      result: {
        runs: result.runs,
        qaResults: result.qaResults,
        escalations: result.escalations,
        budget: result.budget,
        warnings: result.warnings,
        roleExecutions: result.roleExecutions,
      },
      deliverables: Object.keys(deliverables).length > 0 ? deliverables : undefined,
      bundle: {
        ledger: ledgerStore.getLedger(runSessionId) ?? undefined,
      },
    });

    return NextResponse.json({
      success: true,
      runSessionId,
      result,
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[packageWork]")) {
      return err("VALIDATION_ERROR", e.message);
    }
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
