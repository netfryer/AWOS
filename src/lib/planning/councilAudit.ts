/**
 * Executive Council audit of Director output (work packages).
 * Optional, token-capped; enforces governance gates via safe patches only.
 */

// ─── src/lib/planning/councilAudit.ts ───────────────────────────────────────

import { z } from "zod";
import type { ProjectPlan } from "../schemas/governance.js";
import type { AtomicWorkPackage, QaPolicy } from "./packageWork.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Issue {
  code: string;
  packageId: string;
  message: string;
}

export interface Patch {
  path: string;
  op: "replace" | "add";
  value: unknown;
}

export interface CouncilAuditResult {
  auditPass: boolean;
  confidence: number;
  issues: Issue[];
  recommendedPatches: Patch[];
  members: string[];
  skipped?: boolean;
  warning?: string;
}

// ─── Council Response Schema (Zod strict) ────────────────────────────────────

const IssueSchema = z.object({
  code: z.string(),
  packageId: z.string(),
  message: z.string(),
});

const PatchSchema = z.object({
  path: z.string(),
  op: z.enum(["replace", "add"]),
  value: z.unknown(),
});

const CouncilResponseSchema = z
  .object({
    auditPass: z.boolean(),
    confidence: z.number().min(0).max(1),
    issues: z.array(IssueSchema),
    recommendedPatches: z.array(PatchSchema),
  })
  .strict();

type CouncilResponse = z.infer<typeof CouncilResponseSchema>;

// ─── Audit Args ─────────────────────────────────────────────────────────────

export interface AuditDirectorOutputArgs {
  directive: string;
  plan: ProjectPlan;
  packages: AtomicWorkPackage[];
  tierProfile?: string;
  projectBudgetUSD: number;
  underfunded?: boolean;
  ctx: {
    llmExecuteJsonStrict: (args: {
      modelId: string;
      prompt: string;
      zodSchema: z.ZodTypeAny;
    }) => Promise<unknown>;
    pickAuditModels?: (registry: { id: string }[]) => { id: string }[];
    trustTracker: { getTrust: (modelId: string, role?: string) => number };
    modelRegistry: { id: string }[];
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SAFE_PATH_REGEX = /^(\d+)\/(qaPolicy|acceptanceCriteria|importance)$/;

function deriveRiskScore(plan: ProjectPlan): number {
  const risks = plan.risks;
  if (!risks || risks.length === 0) return 0;
  const severityToScore = { low: 0.2, med: 0.5, high: 0.8 } as const;
  let maxScore = 0;
  for (const r of risks) {
    const score =
      r.likelihood ??
      severityToScore[r.severity as keyof typeof severityToScore] ??
      0.5;
    maxScore = Math.max(maxScore, Math.min(1, score));
  }
  return maxScore;
}

function shouldRunAudit(args: {
  riskScore: number;
  packages: AtomicWorkPackage[];
  underfunded?: boolean;
  projectBudgetUSD: number;
  tierProfile?: string;
}): boolean {
  const { riskScore, packages, underfunded, projectBudgetUSD, tierProfile } = args;
  if (riskScore >= 0.5) return true;
  if (packages.some((p) => (p.importance ?? 0) >= 4)) return true;
  if (underfunded) return true;
  if (projectBudgetUSD >= 25) return true;
  if (tierProfile === "premium") return true;
  return false;
}

function pickAuditModelsDefault(
  registry: { id: string }[],
  trustTracker: { getTrust: (id: string, role?: string) => number },
  minQaTrust: number
): { id: string }[] {
  const openai = registry.filter((m) => m.id.startsWith("gpt-"));
  const anthropic = registry.filter((m) => m.id.startsWith("claude-"));
  const withTrust = (arr: { id: string }[]) =>
    arr
      .map((m) => ({ m, trust: trustTracker.getTrust(m.id, "qa") }))
      .filter((x) => x.trust >= minQaTrust)
      .sort((a, b) => b.trust - a.trust);
  const selected: { id: string }[] = [];
  const o = withTrust(openai)[0];
  const a = withTrust(anthropic)[0];
  if (o) selected.push(o.m);
  if (a && !selected.some((s) => s.id.startsWith("claude-"))) selected.push(a.m);
  if (selected.length < 2) {
    const fallback = [...openai, ...anthropic].find((m) => !selected.includes(m));
    if (fallback) selected.push(fallback);
  }
  return selected.slice(0, 2);
}

function buildAuditPrompt(
  directive: string,
  packages: AtomicWorkPackage[]
): string {
  const pkgSummary = packages
    .map((p, i) => {
      const ac = p.acceptanceCriteria?.length ?? 0;
      const qa = p.qaPolicy ? JSON.stringify(p.qaPolicy) : "none";
      return `[${i}] ${p.id} (${p.role}): importance=${p.importance ?? "?"}, acceptanceCriteria=${ac}, qaPolicy=${qa}`;
    })
    .join("\n");

  return `You are an executive council auditor. Review the Director output (work packages) for governance compliance.

Directive: ${directive}

Packages (index, id, role, importance, acceptanceCriteria count, qaPolicy):
${pkgSummary}

Return ONLY a JSON object:
{
  "auditPass": boolean,
  "confidence": number 0-1,
  "issues": [{ "code": string, "packageId": string, "message": string }],
  "recommendedPatches": [{ "path": string, "op": "replace"|"add", "value": unknown }]
}

Allowed patch paths: /<index>/qaPolicy, /<index>/acceptanceCriteria, /<index>/importance
- qaPolicy: replace with partial object to tighten (e.g. deterministicFirst: true)
- acceptanceCriteria: add a string to append
- importance: add number 1 to bump by 1 (max +1)
Return ONLY valid JSON.`;
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.packageId}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSafePatch(
  patch: Patch,
  packages: AtomicWorkPackage[]
): boolean {
  const m = patch.path.match(SAFE_PATH_REGEX);
  if (!m) return false;
  const idx = parseInt(m[1], 10);
  const field = m[2];
  if (idx < 0 || idx >= packages.length) return false;

  if (field === "qaPolicy") {
    if (patch.op !== "replace") return false;
    const v = patch.value;
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    const allowed = ["deterministicFirst", "skipLlmOnPass", "alwaysLlmForHighRisk", "llmSecondPassImportanceThreshold"];
    return Object.keys(o).every((k) => allowed.includes(k));
  }
  if (field === "acceptanceCriteria") {
    if (patch.op !== "add") return false;
    return typeof patch.value === "string" && patch.value.length > 0;
  }
  if (field === "importance") {
    if (patch.op !== "add") return false;
    const v = patch.value;
    return typeof v === "number" && v >= 0 && v <= 1;
  }
  return false;
}

function mergePatches(
  patchesByMember: Array<{ modelId: string; patches: Patch[]; trust: number }>
): Patch[] {
  const byPath = new Map<string, { patch: Patch; trust: number }>();
  for (const { modelId, patches, trust } of patchesByMember) {
    for (const p of patches) {
      if (!byPath.has(p.path) || (byPath.get(p.path)!.trust < trust)) {
        byPath.set(p.path, { patch: p, trust });
      }
    }
  }
  return [...byPath.values()].map((x) => x.patch);
}

function applySafePatches(
  packages: AtomicWorkPackage[],
  patches: Patch[]
): AtomicWorkPackage[] {
  const result = packages.map((p) => ({
    ...p,
    acceptanceCriteria: [...p.acceptanceCriteria],
    qaPolicy: p.qaPolicy ? { ...p.qaPolicy } : undefined,
  }));
  for (const patch of patches) {
    const m = patch.path.match(SAFE_PATH_REGEX);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const field = m[2];
    if (idx < 0 || idx >= result.length) continue;

    const pkg = result[idx];
    if (field === "qaPolicy" && patch.op === "replace") {
      const v = patch.value as Partial<QaPolicy>;
      pkg.qaPolicy = { ...pkg.qaPolicy, ...v } as QaPolicy;
    } else if (field === "acceptanceCriteria" && patch.op === "add" && typeof patch.value === "string") {
      if (!pkg.acceptanceCriteria.includes(patch.value)) {
        pkg.acceptanceCriteria.push(patch.value);
      }
    } else if (field === "importance" && patch.op === "add" && typeof patch.value === "number") {
      const delta = Math.min(1, Math.max(0, patch.value));
      const current = pkg.importance ?? 2;
      pkg.importance = Math.min(5, Math.max(1, Math.round(current + delta)));
    }
  }
  return result;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function auditDirectorOutput(
  args: AuditDirectorOutputArgs
): Promise<{ auditedPackages: AtomicWorkPackage[]; audit: CouncilAuditResult }> {
  const {
    directive,
    plan,
    packages,
    tierProfile,
    projectBudgetUSD,
    underfunded,
    ctx,
  } = args;

  const riskScore = deriveRiskScore(plan);
  const runAudit = shouldRunAudit({
    riskScore,
    packages,
    underfunded,
    projectBudgetUSD,
    tierProfile,
  });

  const planConfidence = plan.scoreBundle?.overall ?? 0.7;

  if (!runAudit) {
    return {
      auditedPackages: packages,
      audit: {
        auditPass: true,
        confidence: planConfidence,
        issues: [],
        recommendedPatches: [],
        members: [],
      },
    };
  }

  const auditModels = ctx.pickAuditModels
    ? ctx.pickAuditModels(ctx.modelRegistry)
    : pickAuditModelsDefault(ctx.modelRegistry, ctx.trustTracker, 0.45);

  if (auditModels.length === 0) {
    return {
      auditedPackages: packages,
      audit: {
        auditPass: true,
        confidence: planConfidence,
        issues: [],
        recommendedPatches: [],
        members: [],
        skipped: true,
        warning: "No audit models available",
      },
    };
  }

  const prompt = buildAuditPrompt(directive, packages);
  const responses: CouncilResponse[] = [];
  const members: string[] = [];
  const trustByMember: Array<{ modelId: string; trust: number }> = [];

  for (const m of auditModels) {
    try {
      const parsed = await ctx.llmExecuteJsonStrict({
        modelId: m.id,
        prompt,
        zodSchema: CouncilResponseSchema,
      });
      const validated = CouncilResponseSchema.safeParse(parsed);
      if (validated.success) {
        responses.push(validated.data);
        members.push(m.id);
        trustByMember.push({
          modelId: m.id,
          trust: ctx.trustTracker.getTrust(m.id, "qa") || 0.5,
        });
      }
    } catch {
      // Skip failed member
    }
  }

  if (responses.length === 0) {
    return {
      auditedPackages: packages,
      audit: {
        auditPass: true,
        confidence: planConfidence,
        issues: [],
        recommendedPatches: [],
        members: [],
        skipped: true,
        warning: "Council audit execution failed for all members",
      },
    };
  }

  const allIssues = dedupeIssues(
    responses.flatMap((r) => r.issues as Issue[])
  );
  const patchesByMember = responses.map((r, i) => ({
    modelId: members[i],
    patches: r.recommendedPatches as Patch[],
    trust: trustByMember[i]?.trust ?? 0.5,
  }));
  const mergedPatches = mergePatches(patchesByMember);
  const safePatches = mergedPatches.filter((p) =>
    isSafePatch(p, packages)
  );
  const auditedPackages = applySafePatches(packages, safePatches);

  const confidences = responses.map((r) => r.confidence);
  const trusts = trustByMember.map((t) => t.trust);
  const totalWeight = trusts.reduce((a, b) => a + b, 0);
  const confidence =
    totalWeight > 0
      ? confidences.reduce(
          (sum, c, i) => sum + c * (trusts[i] ?? 0.5),
          0
        ) / totalWeight
      : confidences.reduce((a, b) => a + b, 0) / confidences.length;

  const auditPass = responses.every((r) => r.auditPass);

  return {
    auditedPackages,
    audit: {
      auditPass,
      confidence,
      issues: allIssues,
      recommendedPatches: safePatches,
      members,
    },
  };
}
