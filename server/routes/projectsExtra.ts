/**
 * Projects API routes - package, run-scenario, run-bundle.
 * Express handlers mirroring Next.js API route logic.
 */

import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { packageWork, validateWorkPackages } from "../../src/lib/planning/packageWork.js";
import { auditDirectorOutput } from "../../src/lib/planning/councilAudit.js";
import { llmExecuteJsonStrict } from "../../src/lib/llm/llmExecuteJson.js";
import { getTrustTracker } from "../../src/lib/governance/trustTracker.js";
import { getModelRegistryForRuntime } from "../../src/lib/model-hr/index.js";
import { planProject } from "../../src/lib/planning/planProject.js";
import { runWorkPackages } from "../../src/lib/execution/runWorkPackages.js";
import {
  createRunSession,
  updateRunSession,
} from "../../src/lib/execution/runSessionStore.js";
import { getRunLedgerStore, getLedgerAsync } from "../../src/lib/observability/runLedger.js";
import { summarizeLedger } from "../../src/lib/observability/analytics.js";
import { llmTextExecute } from "../../src/lib/llm/llmTextExecute.js";
import { route } from "../../src/router.js";
import { deterministicDecomposeDirective } from "../../src/project/deterministicDecomposer.js";
import { getVarianceStatsTracker } from "../../src/varianceStats.js";
import { setPortfolioMode, getPortfolioMode } from "../../src/lib/governance/portfolioConfig.js";
import { getCachedPortfolio } from "../../src/lib/governance/portfolioCache.js";
import type { PortfolioRecommendation } from "../../src/lib/governance/portfolioOptimizer.js";
import {
  CSV_JSON_CLI_DEMO_PACKAGES,
  CSV_JSON_CLI_DEMO_DIRECTIVE,
} from "../../src/lib/execution/presets/csvJsonCliDemo.js";
import { saveDemoRun, extractDeliverablesFromRuns } from "../../app/lib/demoRunsStore.js";
import { runCEONode } from "../../src/lib/rbeg/index.js";
import type { RoleExecutionRecord } from "../../src/lib/observability/runLedger.js";

const PRESETS: Record<
  string,
  { packages: import("../../src/lib/planning/packageWork.js").AtomicWorkPackage[]; directive: string }
> = {
  "csv-json-cli-demo": {
    packages: CSV_JSON_CLI_DEMO_PACKAGES,
    directive: CSV_JSON_CLI_DEMO_DIRECTIVE,
  },
};

function err(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ success: false, error: { code, message, details } });
}

// ─── Package ─────────────────────────────────────────────────────────────────

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

export async function packagePost(req: Request, res: Response) {
  try {
    const raw = req.body;
    let body: z.infer<typeof PackageRequestSchema>;
    try {
      body = normalizeBody(raw);
    } catch (e) {
      return err(
        res,
        400,
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
      return err(res, 400, "VALIDATION_ERROR", "plan is required");
    }

    const packages = packageWork(plan as Parameters<typeof packageWork>[0], { cwd });
    validateWorkPackages(packages);

    let auditedPackages = packages;
    let audit:
      | {
          auditPass: boolean;
          confidence: number;
          issues: unknown[];
          recommendedPatches: unknown[];
          members: string[];
          skipped?: boolean;
          warning?: string;
        }
      | undefined;

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
          plan: plan as unknown as Parameters<typeof auditDirectorOutput>[0]["plan"],
          packages,
          tierProfile,
          projectBudgetUSD,
          ctx: {
            llmExecuteJsonStrict: llmExecuteJsonStrictFn,
            trustTracker: trustTracker as { getTrust: (modelId: string, role?: string) => number },
            modelRegistry,
          },
        });

        auditedPackages = result.auditedPackages;
        audit = result.audit;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Audit failed";
        auditedPackages = packages;
        const planConf =
          plan?.scoreBundle &&
          typeof plan.scoreBundle === "object" &&
          "overall" in plan.scoreBundle
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

    res.json(response);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[packageWork]")) {
      return err(res, 400, "VALIDATION_ERROR", e.message);
    }
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err(res, 500, "INTERNAL_ERROR", msg);
  }
}

// ─── Run Scenario ────────────────────────────────────────────────────────────

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
  concurrency: z
    .object({
      worker: z.number().int().positive().optional(),
      qa: z.number().int().positive().optional(),
    })
    .optional(),
  async: z.boolean().default(true),
  cwd: z.string().optional(),
  trust: z.boolean().optional(),
  variance: z.boolean().optional(),
});

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

export async function runScenarioPost(req: Request, res: Response) {
  try {
    const raw = req.body;
    if (raw == null || typeof raw !== "object") {
      return err(res, 400, "VALIDATION_ERROR", "Request body must be a JSON object");
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
      return err(res, 400, "VALIDATION_ERROR", "Invalid request body", details);
    }
    const body = parsed.data;

    if (body.directive == null && body.presetId == null) {
      return err(res, 400, "VALIDATION_ERROR", "Either directive or presetId must be provided");
    }
    if (body.presetId != null && !PRESETS[body.presetId]) {
      return err(
        res,
        400,
        "VALIDATION_ERROR",
        `Unknown presetId: ${body.presetId}. Available: ${Object.keys(PRESETS).join(", ")}`
      );
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

    let plan: import("../../src/lib/schemas/governance.js").ProjectPlan | undefined;
    let packages: import("../../src/lib/planning/packageWork.js").AtomicWorkPackage[];
    const directive = body.presetId
      ? PRESETS[body.presetId].directive
      : (body.directive as string);

    const difficulty = body.difficulty ?? "medium";
    runCEONode(directive, body.projectBudgetUSD, difficulty);
    const ceoRoleExec: RoleExecutionRecord = {
      nodeId: "ceo",
      role: "ceo",
      status: "ok",
      costUSD: 0,
    };
    const managerRoleExec: RoleExecutionRecord = {
      nodeId: "manager",
      role: "manager",
      status: "ok",
      costUSD: 0,
    };

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

      const subtasks = deterministicDecomposeDirective(directive);
      const subtasksWithBudget = subtasks.map((s) => ({
        ...s,
        allocatedBudgetUSD:
          s.allocatedBudgetUSD ?? body.projectBudgetUSD / Math.max(1, subtasks.length),
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
    let audit:
      | {
          auditPass: boolean;
          confidence: number;
          issues: unknown[];
          recommendedPatches: unknown[];
          members: string[];
          skipped?: boolean;
          warning?: string;
        }
      | undefined;

    if (body.includeCouncilAudit && body.directive && plan) {
      try {
        const llmExecuteJsonStrictFn = (args: {
          modelId: string;
          prompt: string;
          zodSchema: z.ZodTypeAny;
        }) => llmExecuteJsonStrict(args);

        const auditResult = await auditDirectorOutput({
          directive: body.directive,
          plan: plan as unknown as Parameters<typeof auditDirectorOutput>[0]["plan"],
          packages,
          tierProfile: body.tierProfile,
          projectBudgetUSD: body.projectBudgetUSD,
          ctx: {
            llmExecuteJsonStrict: llmExecuteJsonStrictFn,
            trustTracker: trustTracker as { getTrust: (modelId: string, role?: string) => number },
            modelRegistry,
          },
        });

        auditedPackages = auditResult.auditedPackages;
        audit = auditResult.audit;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Audit failed";
        auditedPackages = packages;
        const planConf =
          plan?.scoreBundle &&
          typeof plan.scoreBundle === "object" &&
          "overall" in plan.scoreBundle
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
      return res.json({
        success: true,
        estimateOnly: true,
        plan,
        packages: auditedPackages,
        ...(audit && { audit }),
      });
    }

    const workerCount = auditedPackages.filter(
      (p: { role: string }) => p.role === "Worker"
    ).length;
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
      await Promise.resolve(
        ledgerStore.finalizeLedger(runSessionId, {
          roleExecutions: [ceoRoleExec, managerRoleExecFail],
        })
      );
      return err(res, 400, "VALIDATION_ERROR", `Manager output validation failed: ${msg}`, {
        reason: msg,
      });
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
      route: (
        task: Parameters<typeof route>[0],
        models: Parameters<typeof route>[1],
        config?: unknown,
        directive?: string,
        portfolioOptions?: Parameters<typeof route>[4],
        routingOptions?: Parameters<typeof route>[5]
      ) =>
        route(task, models, config as Parameters<typeof route>[2], directive, portfolioOptions, routingOptions),
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
    } as Parameters<typeof runWorkPackages>[0];

    if (body.async) {
      Promise.resolve()
        .then(async () => {
          try {
            const result = await runWorkPackages(runInput);
            await Promise.resolve(
              ledgerStore.finalizeLedger(runSessionId, {
                completed: result.runs.length + result.qaResults.length,
              })
            );
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
            const asyncLedger = await getLedgerAsync(runSessionId);
            const asyncSummary = asyncLedger ? summarizeLedger(asyncLedger) : undefined;
            const deliverables = extractDeliverablesFromRuns(result.runs);
            await saveDemoRun(runSessionId, {
              runSessionId,
              timestamp: new Date().toISOString(),
              plan,
              packages: auditedPackages,
              result: {
                runs: result.runs,
                qaResults: result.qaResults,
                escalations: result.escalations,
                budget: result.budget,
                warnings: result.warnings,
              },
              deliverables:
                Object.keys(deliverables).length > 0 ? deliverables : undefined,
              bundle: {
                ledger: asyncLedger ?? undefined,
                summary: asyncSummary ?? undefined,
              },
            });
          } catch (e) {
            await Promise.resolve(ledgerStore.finalizeLedger(runSessionId));
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

      return res.json({
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
    await Promise.resolve(
      ledgerStore.finalizeLedger(runSessionId, {
        completed: result.runs.length + result.qaResults.length,
        roleExecutions: fullRoleExecutions,
      })
    );

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

    const ledger = await getLedgerAsync(runSessionId);
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
      result: {
        runs: result.runs,
        qaResults: result.qaResults,
        escalations: result.escalations,
        budget: result.budget,
        warnings: result.warnings,
        roleExecutions: fullRoleExecutions,
      },
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

    return res.json({
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
      return err(res, 400, "VALIDATION_ERROR", e.message);
    }
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err(res, 500, "INTERNAL_ERROR", msg);
  }
}

// ─── Run Bundle ──────────────────────────────────────────────────────────────

export async function runBundleGet(req: Request, res: Response) {
  try {
    const id = req.query.id as string | undefined;
    const includeTrust = req.query.trust !== "false";
    const includeVariance = req.query.variance !== "false";

    if (!id) {
      return err(res, 400, "VALIDATION_ERROR", "Missing required query parameter: id");
    }

    const ledger = await getLedgerAsync(id);

    if (!ledger) {
      return err(res, 404, "NOT_FOUND", `Ledger not found for runSessionId: ${id}`);
    }

    const summary = summarizeLedger(ledger);

    const bundle: Record<string, unknown> = {
      ledger,
      summary,
    };

    if (includeTrust) {
      const trustTracker = getTrustTracker();
      const trust = trustTracker.getTrustMap();
      if (Object.keys(trust).length > 0) {
        bundle.trust = trust;
      }
    }

    if (includeVariance) {
      const varianceTracker = getVarianceStatsTracker();
      const stats = await varianceTracker.getStats();
      bundle.variance = stats;
    }

    res.set({
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="run-bundle-${id}.json"`,
    });
    res.json({ success: true, bundle });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err(res, 500, "INTERNAL_ERROR", msg);
  }
}
