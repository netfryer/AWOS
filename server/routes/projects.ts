/**
 * Projects API routes - plan, run-packages, run-session.
 */

import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { runWorkPackages } from "../../src/lib/execution/runWorkPackages.js";
import {
  createRunSession,
  updateRunSession,
  getRunSessionAsync,
} from "../../src/lib/execution/runSessionStore.js";
import { getRunLedgerStore, getLedgerAsync } from "../../src/lib/observability/runLedger.js";
import { route } from "../../src/router.js";
import { getPortfolioMode } from "../../src/lib/governance/portfolioConfig.js";
import { getCachedPortfolio } from "../../src/lib/governance/portfolioCache.js";
import type { PortfolioRecommendation } from "../../src/lib/governance/portfolioOptimizer.js";
import { getVarianceStatsTracker } from "../../src/varianceStats.js";
import { getTrustTracker } from "../../src/lib/governance/trustTracker.js";
import { llmTextExecute } from "../../src/lib/llm/llmTextExecute.js";
import { getModelRegistryForRuntime } from "../../src/lib/model-hr/index.js";
import { planProject } from "../../src/lib/planning/planProject.js";
import { llmExecuteJsonStrict } from "../../src/lib/llm/llmExecuteJson.js";
import { deterministicDecomposeDirective } from "../../src/project/deterministicDecomposer.js";
import { saveDemoRun, extractDeliverablesFromRuns } from "../../app/lib/demoRunsStore.js";

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
  concurrency: z
    .object({
      worker: z.number().int().positive().optional(),
      qa: z.number().int().positive().optional(),
    })
    .optional(),
  cheapestViableChosen: z.boolean().optional(),
});

function err(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ success: false, error: { code, message, details } });
}

export async function planPost(req: Request, res: Response) {
  try {
    const raw = req.body;
    const parsed = PlanRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const details = Array.isArray((parsed.error as { issues?: unknown[] })?.issues)
        ? (parsed.error as { issues: unknown[] }).issues.map((i: unknown) => {
            const item = i as { path?: unknown[]; message?: string };
            return { path: item.path ?? [], message: item.message ?? "invalid" };
          })
        : "Validation failed";
      return err(res, 400, "VALIDATION_ERROR", "Invalid request body", details);
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
      trustTracker: {
        getTrust: (m: string) => trustTracker.getTrust(m),
        setTrust: (_m: string, _s: number) => {},
      },
      route: (
        task: Parameters<typeof route>[0],
        models: Parameters<typeof route>[1],
        config?: unknown,
        directive?: string
      ) => route(task, models, config as Parameters<typeof route>[2], directive),
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
    res.json(response);
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function runPackagesPost(req: Request, res: Response) {
  try {
    const raw = req.body;
    if (raw == null || typeof raw !== "object") {
      return err(res, 400, "VALIDATION_ERROR", "Request body must be a JSON object");
    }
    const parsed = RunPackagesRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const details = Array.isArray((parsed.error as { issues?: unknown[] })?.issues)
        ? (parsed.error as { issues: unknown[] }).issues.map((i: unknown) => {
            const item = i as { path?: unknown[]; message?: string };
            return { path: item.path ?? [], message: item.message ?? "invalid" };
          })
        : "Validation failed";
      return err(res, 400, "VALIDATION_ERROR", "Invalid request body", details);
    }
    const body = parsed.data;
    const asyncMode = req.query.async === "true";
    const varianceTracker = getVarianceStatsTracker();
    const trustTracker = getTrustTracker();
    const ledgerStore = getRunLedgerStore();
    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const workerCount = body.packages.filter((p) => p.role === "Worker").length;
    const qaCount = body.packages.filter((p) => p.role === "QA").length;

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
          { modelRegistry, trustTracker, varianceStatsTracker: varianceTracker },
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
        route: (
          task: Parameters<typeof route>[0],
          models: Parameters<typeof route>[1],
          config?: unknown,
          directive?: string,
          portfolioOptions?: Parameters<typeof route>[4],
          routingOptions?: Parameters<typeof route>[5]
        ) => route(task, models, config as Parameters<typeof route>[2], directive, portfolioOptions, routingOptions),
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
      } as Parameters<typeof runWorkPackages>[0];
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
              bundle: { ledger: (await getLedgerAsync(runSessionId)) ?? undefined },
            });
          } catch (e) {
            await Promise.resolve(ledgerStore.finalizeLedger(runSessionId));
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
      return res.json({ success: true, runSessionId });
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
        { modelRegistry, trustTracker, varianceStatsTracker: varianceTracker },
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
      route: (
        task: Parameters<typeof route>[0],
        models: Parameters<typeof route>[1],
        config?: unknown,
        directive?: string,
        portfolioOptions?: Parameters<typeof route>[4],
        routingOptions?: Parameters<typeof route>[5]
      ) => route(task, models, config as Parameters<typeof route>[2], directive, portfolioOptions, routingOptions),
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
    } as Parameters<typeof runWorkPackages>[0];
    const result = await runWorkPackages(runInput);
    await Promise.resolve(
      ledgerStore.finalizeLedger(runSessionId, {
        completed: result.runs.length + result.qaResults.length,
        roleExecutions: result.roleExecutions,
      })
    );
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
      bundle: { ledger: (await getLedgerAsync(runSessionId)) ?? undefined },
    });
    res.json({ success: true, runSessionId, result });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[packageWork]")) {
      return err(res, 400, "VALIDATION_ERROR", e.message);
    }
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function runSessionGet(req: Request, res: Response) {
  try {
    const id = req.query.id as string;
    if (!id?.trim()) {
      return err(res, 400, "VALIDATION_ERROR", "Missing required query param: id");
    }
    const session = await getRunSessionAsync(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Run session not found" },
      });
    }
    res.json({ success: true, session });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function ledgerGet(req: Request, res: Response) {
  try {
    const id = (req.query.id as string)?.trim();
    if (!id) {
      return err(res, 400, "VALIDATION_ERROR", "Missing required query parameter: id");
    }
    const ledger = await getLedgerAsync(id);
    if (!ledger) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Ledger not found for runSessionId: ${id}` },
      });
    }
    res.json({ success: true, ledger });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}
