/**
 * Deterministic scoring and gate decision for StrategyBrief.
 */

import type {
  StrategyBrief,
  ExecutiveDraft,
  BriefScore,
  GateDecision,
  ExecOption,
} from "./types.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a.map((s) => s.toLowerCase().trim()));
  const setB = new Set(b.map((s) => s.toLowerCase().trim()));
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : inter / union;
}

function optionValid(o: ExecOption): boolean {
  const hasCost =
    o.roughCostUSD?.low != null &&
    o.roughCostUSD?.likely != null &&
    o.roughCostUSD?.high != null;
  const hasTimeline =
    o.roughTimeline?.lowWeeks != null &&
    o.roughTimeline?.likelyWeeks != null &&
    o.roughTimeline?.highWeeks != null;
  const hasImpact = o.expectedImpact?.metric != null;
  const hasProsCons = Array.isArray(o.pros) && Array.isArray(o.cons);
  const hasRisks = Array.isArray(o.risks);
  return !!(hasCost && hasTimeline && hasImpact && hasProsCons && hasRisks);
}

export function scoreBrief(
  brief: StrategyBrief | undefined,
  drafts: ExecutiveDraft[]
): BriefScore {
  const reasons: string[] = [];
  let completeness = 0;
  let feasibility = 0;
  let measurability = 0;
  let riskCoverage = 0;
  let costPlausibility = 0;
  let consensus = 0;

  if (!brief) {
    return {
      completeness: 0,
      feasibility: 0,
      measurability: 0,
      riskCoverage: 0,
      costPlausibility: 0,
      consensus: 0,
      overall: 0,
      reasons: ["No brief produced"],
    };
  }

  const optCount = brief.options?.length ?? 0;
  const hasObjective = !!(brief.objective?.trim());
  const optionsValid = (brief.options ?? []).every(optionValid);
  const plan = brief.recommendedPlan;
  const hasWorkstreams = (plan?.workstreams?.length ?? 0) >= 1;
  const hasPhases = (plan?.phases?.length ?? 0) >= 2;
  const hasKpis = (plan?.kpis?.length ?? 0) >= 1;
  completeness = clamp(
    (hasObjective ? 0.2 : 0) +
      (optCount >= 2 ? 0.3 : optCount >= 1 ? 0.15 : 0) +
      (optionsValid ? 0.3 : 0) +
      (hasWorkstreams && hasPhases && hasKpis ? 0.2 : 0)
  );
  if (!hasObjective) reasons.push("Missing objective");
  if (optCount < 2) reasons.push("Fewer than 2 options");
  if (!optionsValid) reasons.push("Options missing pros/cons/risks/cost/timeline/impact");
  if (!hasWorkstreams || !hasPhases || !hasKpis)
    reasons.push("Recommended plan incomplete");

  const phases = plan?.phases ?? [];
  const phasesComplete =
    phases.length >= 2 &&
    phases.every(
      (p) =>
        Array.isArray(p.deliverables) &&
        p.deliverables.length >= 1 &&
        Array.isArray(p.exitCriteria) &&
        p.exitCriteria.length >= 1
    );
  const depsPresent = (brief.options ?? []).some(
    (o) => Array.isArray(o.dependencies) && o.dependencies.length >= 0
  );
  feasibility = clamp(
    (phasesComplete ? 0.6 : 0) + (depsPresent ? 0.4 : 0.2)
  );
  if (!phasesComplete) reasons.push("Phases need deliverables and exit criteria");

  const kpiCount = plan?.kpis?.length ?? 0;
  const hasImpact = (brief.options ?? []).some(
    (o) => o.expectedImpact?.metric != null
  );
  measurability = clamp(
    (kpiCount >= 2 ? 0.5 : kpiCount >= 1 ? 0.3 : 0) + (hasImpact ? 0.5 : 0.2)
  );
  if (kpiCount < 2) reasons.push("Need at least 2 KPIs");
  if (!hasImpact) reasons.push("Options need expectedImpact metric");

  const riskReg = brief.governance?.riskRegister ?? [];
  const riskWithMit =
    riskReg.filter((r) => r.mitigation?.trim()).length;
  const hasCompliance =
    Array.isArray(brief.governance?.complianceChecklist);
  riskCoverage = clamp(
    (riskReg.length >= 2 ? 0.5 : riskReg.length >= 1 ? 0.3 : 0) +
      (riskWithMit >= 2 ? 0.3 : riskWithMit >= 1 ? 0.2 : 0) +
      (hasCompliance ? 0.2 : 0)
  );
  if (riskReg.length < 2) reasons.push("Risk register needs at least 2 items");
  if (riskWithMit < 2) reasons.push("At least 2 risks need mitigations");

  const budget = brief.downstreamBudgetEstimateUSD;
  const budgetOrdered =
    budget != null &&
    budget.low <= budget.likely &&
    budget.likely <= budget.high;
  let costOk = budgetOrdered ? 0.5 : 0;
  for (const o of brief.options ?? []) {
    const c = o.roughCostUSD;
    const t = o.roughTimeline;
    if (
      c &&
      c.low <= c.likely &&
      c.likely <= c.high &&
      t &&
      t.lowWeeks <= t.likelyWeeks &&
      t.likelyWeeks <= t.highWeeks
    ) {
      costOk += 0.5 / Math.max(1, (brief.options?.length ?? 1));
    }
  }
  costPlausibility = clamp(costOk);
  if (!budgetOrdered) reasons.push("Budget estimate not ordered low<=likely<=high");

  const recs = drafts
    .map((d) => d.recommendedOptionId)
    .filter((r): r is "A" | "B" | "C" => r != null);
  const counts: Record<string, number> = {};
  for (const r of recs) {
    counts[r] = (counts[r] ?? 0) + 1;
  }
  const majority = Math.max(0, ...Object.values(counts)) / Math.max(1, recs.length);
  const assumpArrays = drafts.map((d) => d.assumptions ?? []).flat();
  const questionArrays = drafts.map((d) => d.clarifyingQuestions ?? []).flat();
  const jaccardAssump =
    drafts.length >= 2
      ? jaccard(drafts[0].assumptions ?? [], drafts[1].assumptions ?? [])
      : 1;
  const jaccardQuest =
    drafts.length >= 2
      ? jaccard(
          drafts[0].clarifyingQuestions ?? [],
          drafts[1].clarifyingQuestions ?? []
        )
      : 1;
  consensus = clamp(
    majority * 0.6 + (jaccardAssump + jaccardQuest) * 0.2
  );
  if (majority < 0.6) reasons.push("Low agreement on recommended option");

  const overall =
    completeness * 0.2 +
    feasibility * 0.2 +
    measurability * 0.15 +
    riskCoverage * 0.15 +
    costPlausibility * 0.1 +
    consensus * 0.2;

  return {
    completeness,
    feasibility,
    measurability,
    riskCoverage,
    costPlausibility,
    consensus,
    overall: clamp(overall),
    reasons,
  };
}

export function gateDecision(score: BriefScore, brief?: StrategyBrief): GateDecision {
  if (score.overall >= 0.75 && score.consensus >= 0.6) {
    return {
      status: "approve",
      notes: ["Brief meets quality and consensus thresholds"],
    };
  }
  if (score.overall >= 0.55) {
    const requiredQuestions =
      brief?.questionsForCEO?.slice(0, 10) ?? score.reasons.slice(0, 5);
    return {
      status: "needs_clarification",
      requiredQuestions: requiredQuestions.length > 0 ? requiredQuestions : undefined,
      notes: score.reasons.length > 0 ? score.reasons : ["Clarification needed"],
    };
  }
  return {
    status: "reject",
    notes: score.reasons.length > 0 ? score.reasons : ["Brief does not meet minimum quality"],
  };
}
