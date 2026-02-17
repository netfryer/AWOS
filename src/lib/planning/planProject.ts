/**
 * Executive Council planning: baseline subtasks + optional council refinement.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { clamp01, type ProjectPlan, type RiskItem } from "../schemas/governance.js";
import type { ProjectSubtask, RecommendedTier } from "../../project/types.js";
import type { ModelSpec, TaskCard, RoutingDecision } from "../../types.js";
import { optimizePlanBudgets, type OptimizableSubtask, type PlanWithSubtasks } from "./optimizePlanBudgets.js";
import type { RunLedgerStore } from "../observability/runLedger.js";

// ─── Request / Context Types ───────────────────────────────────────────────

export interface PlanningProjectRequest {
  directive: string;
  projectBudgetUSD: number;
  tierProfile?: string;
  estimateOnly: boolean;
  difficulty?: "low" | "medium" | "high";
  subtasks?: ProjectSubtask[];
}

export interface TrustTracker {
  getTrust(modelId: string): number;
  setTrust(modelId: string, score: number): void;
}

export interface VarianceStatsTrackerLike {
  getCalibration(
    modelId: string,
    taskType: string
  ): Promise<{
    nCost: number;
    costMultiplier: number | null;
    nQuality: number;
    qualityBias: number | null;
  }>;
}

export interface PlanningContext {
  modelRegistry: ModelSpec[];
  varianceStatsTracker: VarianceStatsTrackerLike;
  trustTracker: TrustTracker;
  route: (
    task: TaskCard,
    models: ModelSpec[],
    config?: unknown,
    directive?: string
  ) => RoutingDecision;
  deterministicDecomposeDirective: (directive: string) => ProjectSubtask[];
  llmExecute: (
    modelId: string,
    prompt: string,
    jsonSchema: z.ZodType
  ) => Promise<unknown>;
  MIN_COUNCIL_MEMBERS?: number;
  ledger?: RunLedgerStore;
  runSessionId?: string;
}

export interface ProjectPlanResult {
  plan: ProjectPlan;
  underfunded?: boolean;
  budgetWarnings?: string[];
  councilDebug?: {
    members: string[];
    rawVotes: unknown[];
  };
}

// ─── Council Response Schema ────────────────────────────────────────────────

const CouncilRiskSchema = z.object({
  title: z.string(),
  severity: z.enum(["low", "med", "high"]),
  likelihood: z.number().min(0).max(1).optional(),
  mitigation: z.string().optional(),
});

const SubtaskAdjustmentSchema = z.object({
  subtaskId: z.string(),
  importanceDelta: z.number().optional(),
  recommendedTier: z.enum(["cheap", "standard", "premium"]).optional(),
  rationale: z.string().optional(),
});

const CouncilResponseSchema = z.object({
  planImprovements: z.array(z.string()),
  risks: z.array(CouncilRiskSchema),
  budgetWarnings: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  subtaskAdjustments: z.array(SubtaskAdjustmentSchema),
});

type CouncilResponse = z.infer<typeof CouncilResponseSchema>;

// ─── Risk Scoring ──────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<string, number> = {
  low: 0.33,
  med: 0.66,
  high: 1,
};

export function riskScore(risks: { severity: string; likelihood?: number }[]): number {
  if (risks.length === 0) return 0;
  let max = 0;
  for (const r of risks) {
    const sev = SEVERITY_WEIGHT[r.severity] ?? 0.5;
    const lik = r.likelihood ?? 0.5;
    const score = sev * lik;
    if (score > max) max = score;
  }
  return clamp01(max);
}

// ─── Council Model Selection ───────────────────────────────────────────────

function pickCouncilModels(
  models: ModelSpec[],
  count: number
): ModelSpec[] {
  const openai = models.filter((m) => m.id.startsWith("gpt-"));
  const anthropic = models.filter((m) => m.id.startsWith("claude-"));
  const byCost = [...models].sort(
    (a, b) =>
      a.pricing.inPer1k + a.pricing.outPer1k -
      (b.pricing.inPer1k + b.pricing.outPer1k)
  );
  const cheap = byCost[0];
  const selected: ModelSpec[] = [];
  if (openai.length > 0 && !selected.some((m) => m.id.startsWith("gpt-"))) {
    selected.push(openai[0]);
  }
  if (anthropic.length > 0 && !selected.some((m) => m.id.startsWith("claude-"))) {
    selected.push(anthropic[0]);
  }
  if (cheap && !selected.includes(cheap)) {
    selected.push(cheap);
  }
  while (selected.length < count && models.length > 0) {
    const next = models.find((m) => !selected.includes(m));
    if (next) selected.push(next);
    else break;
  }
  return selected.slice(0, count);
}

// ─── Main Planning Logic ───────────────────────────────────────────────────

const BUDGET_RESERVE_PCT = 0.1;
const MIN_COUNCIL = 3;

export async function planProject(
  req: PlanningProjectRequest,
  ctx: PlanningContext
): Promise<ProjectPlanResult> {
  const minCouncil = ctx.MIN_COUNCIL_MEMBERS ?? MIN_COUNCIL;
  const subtasks: ProjectSubtask[] =
    req.subtasks ?? ctx.deterministicDecomposeDirective(req.directive);

  const usableBudget = req.projectBudgetUSD * (1 - BUDGET_RESERVE_PCT);
  const totalImportance = subtasks.reduce((s, t) => s + t.importance, 0) || 1;

  const workPackages = subtasks.map((s) => ({
    id: s.id,
    name: s.title,
    description: s.description,
    ownerRole: "owner" as const,
    deliverables: [s.description],
  }));

  const plan: PlanWithSubtasks = {
    id: randomUUID(),
    objective: req.directive,
    workPackages,
    risks: undefined,
    scoreBundle: undefined,
    createdAt: new Date().toISOString(),
    subtasks,
    budget: { reserveUSD: req.projectBudgetUSD * BUDGET_RESERVE_PCT },
  };

  const optResult = await optimizePlanBudgets(plan, {
    projectBudgetUSD: req.projectBudgetUSD,
    tierProfile: (req.tierProfile as "cheap" | "standard" | "premium") ?? "standard",
    modelRegistry: ctx.modelRegistry,
    trustTracker: ctx.trustTracker,
    varianceStatsTracker: ctx.varianceStatsTracker,
  });

  const budgetWarnings: string[] = [...optResult.warnings];
  if (optResult.plan.budget?.warnings) {
    plan.budget!.warnings = optResult.plan.budget.warnings;
  }

  const optSubtasks = (plan.subtasks ?? []) as OptimizableSubtask[];
  const rScore = riskScore(plan.risks ?? []);
  const anyUnderfundedImportance4 = optSubtasks.some(
    (s) => s.underfunded === true && s.importance >= 4
  );
  const warningsIncludeUnderfundedOrDeferred = (plan.budget?.warnings ?? []).some(
    (w) => w.includes("underfunded") || w.includes("Deferred")
  );
  const anyDeferredImportance4 = optSubtasks.some(
    (s) => s.deferred === true && s.importance >= 4
  );

  const runCouncil =
    !req.estimateOnly &&
    (rScore >= 0.7 ||
      anyUnderfundedImportance4 ||
      (warningsIncludeUnderfundedOrDeferred && anyDeferredImportance4));

  let risks: RiskItem[] = [];
  let councilDebug: ProjectPlanResult["councilDebug"];

  if (runCouncil && ctx.modelRegistry.length >= minCouncil) {
    const councilModels = pickCouncilModels(ctx.modelRegistry, minCouncil);
    const prompt = buildCouncilPrompt(req, optSubtasks, usableBudget);

    const rawVotes: unknown[] = [];
    const allRisks: CouncilResponse["risks"] = [];
    const trustMap = new Map<string, number>();

    for (const m of councilModels) {
      trustMap.set(m.id, ctx.trustTracker.getTrust(m.id) || 0.5);
      try {
        const parsed = await ctx.llmExecute(
          m.id,
          prompt,
          CouncilResponseSchema
        );
        const resp = CouncilResponseSchema.safeParse(parsed);
        if (resp.success) {
          rawVotes.push(resp.data);
          allRisks.push(...resp.data.risks);
        } else {
          rawVotes.push({ parseError: true, raw: parsed });
        }
      } catch {
        rawVotes.push({ error: "execution failed" });
      }
    }

    risks = aggregateRisks(allRisks);
    plan.risks = risks.length > 0 ? risks : undefined;
    for (const v of rawVotes) {
      const r = CouncilResponseSchema.safeParse(v);
      if (r.success) {
        for (const w of r.data.budgetWarnings) budgetWarnings.push(w);
      }
    }

    councilDebug = {
      members: councilModels.map((m) => m.id),
      rawVotes,
    };

    for (const v of rawVotes) {
      const r = CouncilResponseSchema.safeParse(v);
      if (!r.success) continue;
      for (const adj of r.data.subtaskAdjustments) {
        const sub = optSubtasks.find((s) => s.id === adj.subtaskId);
        if (!sub) continue;
        if (adj.importanceDelta != null) {
          const newImp = clamp01(sub.importance + adj.importanceDelta);
          sub.importance = Math.max(1, Math.min(5, newImp * 5));
        }
        if (adj.recommendedTier != null) {
          sub.recommendedTier = adj.recommendedTier;
        }
      }
    }
  } else if (!req.estimateOnly && ctx.ledger && ctx.runSessionId) {
    ctx.ledger.recordCouncilPlanningSkipped(ctx.runSessionId, "policy_exception_only");
  }

  for (const s of optSubtasks) {
    const allocated = (s.budgetUSD ?? s.allocatedBudgetUSD ?? usableBudget * (s.importance / totalImportance));
    s.allocatedBudgetUSD = allocated;
    const task: TaskCard = {
      id: s.id,
      taskType: s.taskType,
      difficulty: s.difficulty,
      constraints: { maxCostUSD: allocated },
    };
    const routing = ctx.route(
      task,
      ctx.modelRegistry,
      undefined,
      s.description
    );
    if (
      routing.chosenModelId == null &&
      ctx.modelRegistry.some((m) => {
        const est =
          (2500 / 1000) * m.pricing.inPer1k +
          (1500 / 1000) * m.pricing.outPer1k;
        return est <= allocated;
      })
    ) {
      budgetWarnings.push(
        `Subtask "${s.title}" (${s.id}): no model fits allocated $${allocated.toFixed(4)}`
      );
    }
  }

  const underfunded =
    budgetWarnings.length > 0 || optSubtasks.some((s) => s.underfunded === true);

  return {
    plan,
    underfunded,
    budgetWarnings: budgetWarnings.length > 0 ? budgetWarnings : undefined,
    councilDebug,
  };
}

function buildCouncilPrompt(
  req: PlanningProjectRequest,
  subtasks: ProjectSubtask[],
  usableBudget: number
): string {
  const subList = subtasks
    .map(
      (s) =>
        `- ${s.id}: ${s.title} (importance ${s.importance}, tier ${s.recommendedTier ?? "standard"}, alloc ~$${(usableBudget * (s.importance / subtasks.reduce((a, t) => a + t.importance, 0))).toFixed(4)})`
    )
    .join("\n");

  return `You are an executive council member reviewing a project plan.

Directive: ${req.directive}
Usable budget (after 10% reserve): $${usableBudget.toFixed(4)}

Baseline subtasks:
${subList}

Return a JSON object with:
- planImprovements: string[] (suggested improvements)
- risks: [{ title, severity: "low"|"med"|"high", likelihood?: 0-1, mitigation? }]
- budgetWarnings: string[] (concerns about budget allocation)
- confidence: number 0-1 (your confidence in this plan)
- subtaskAdjustments: [{ subtaskId, importanceDelta?: number, recommendedTier?: "cheap"|"standard"|"premium", rationale? }]

Return ONLY valid JSON.`;
}

function aggregateRisks(
  councilRisks: { title: string; severity: string; likelihood?: number; mitigation?: string }[]
): RiskItem[] {
  const byTitle = new Map<
    string,
    { severity: string; likelihood: number; mitigation: string }
  >();
  for (const r of councilRisks) {
    const key = r.title.toLowerCase().trim();
    const existing = byTitle.get(key);
    const sev = r.severity ?? "med";
    const lik = r.likelihood ?? 0.5;
    const mit = r.mitigation ?? "";
    if (!existing || SEVERITY_WEIGHT[sev] > SEVERITY_WEIGHT[existing.severity]) {
      byTitle.set(key, { severity: sev, likelihood: lik, mitigation: mit });
    }
  }
  return [...byTitle.entries()].map(([title, v], i) => ({
    id: `risk-${i + 1}`,
    risk: title,
    severity: v.severity as "low" | "med" | "high",
    mitigation: v.mitigation,
    likelihood: v.likelihood,
  }));
}
