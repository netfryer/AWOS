/**
 * Stage 5.3: Policy evaluation stats aggregation.
 * Pure function to aggregate policyEval data from run log events.
 */

import type { RunLogEvent } from "./runLog.js";

export interface GateRejectionCounts {
  savingsPct: number;
  confidence: number;
  gap: number;
  noPromotionTarget: number;
  budget: number;
}

export interface PolicyStatsTotals {
  runs: number;
  usedCheapFirst: number;
  cheapFirstRate: number;
  escalations: number;
  escalationRate: number;
  avgEstimatedSavingsUSD: number;
  avgEstimatedSavingsPct: number;
  avgRealizedTotalCostUSD: number;
  avgFinalScore: number;
}

export interface PolicyStatsSlice {
  runs: number;
  cheapFirstRate: number;
  escalationRate: number;
  avgSavingsUSD: number;
  avgRealizedCostUSD: number;
  avgFinalScore: number;
}

export interface PolicyRegretExample {
  runId: string;
  taskType: string;
  difficulty: string;
  normalChoiceModelId: string;
  chosenAttempt1ModelId: string;
  finalModelId: string;
  escalationUsed: boolean;
  finalScore?: number;
  targetScore?: number;
  realizedTotalCostUSD?: number;
  estimatedSavingsUSD: number;
}

export interface PolicyEconomicRegretExample extends PolicyRegretExample {
  normalChoiceExpectedCostUSD: number;
}

export interface PolicyStatsResponse {
  totals: PolicyStatsTotals;
  byTaskType: Record<string, PolicyStatsSlice>;
  byDifficulty: Record<string, PolicyStatsSlice>;
  regret: {
    count: number;
    examples: PolicyRegretExample[];
  };
  /** Economic regret: cheap-first used, escalation used, realizedTotalCost > normalChoiceExpectedCost */
  economicRegret: {
    count: number;
    examples: PolicyEconomicRegretExample[];
  };
  /** Counts of runs where cheap-first was rejected, by gate reason (for runs with gateRejectionCounts) */
  gateRejectionCounts: {
    totals: GateRejectionCounts;
    byTaskType: Record<string, GateRejectionCounts>;
    byDifficulty: Record<string, GateRejectionCounts>;
  };
  /** Counts of runs where cheap-first was not used, by gateReason string */
  gateReasonCounts: Record<string, number>;
  /** Stage 6.3: Counts by primary blocker (first gate that eliminated all candidates) */
  primaryBlockerCounts: {
    totals: Record<string, number>;
    byTaskType: Record<string, Record<string, number>>;
    byDifficulty: Record<string, Record<string, number>>;
  };
}

function isRegret(e: RunLogEvent): boolean {
  const pe = e.policyEval;
  if (!pe?.enabled || !pe.usedCheapFirst || pe.result.escalationUsed) return false;
  const { finalScore, targetScore } = pe.result;
  return (
    finalScore != null &&
    targetScore != null &&
    finalScore < targetScore
  );
}

/** Economic regret: cheap-first used, escalation used, realizedTotalCost > normalChoiceExpectedCost */
function isEconomicRegret(e: RunLogEvent): boolean {
  const pe = e.policyEval;
  if (!pe?.enabled || !pe.usedCheapFirst || !pe.result.escalationUsed) return false;
  const realized = pe.result.realizedTotalCostUSD;
  const normalExpected = pe.normalChoice.expectedCostUSD;
  return realized != null && normalExpected != null && realized > normalExpected;
}

export function aggregatePolicyStats(events: RunLogEvent[]): PolicyStatsResponse {
  const withPolicy = events.filter((e) => e.policyEval?.enabled === true);

  const totals: PolicyStatsTotals = {
    runs: withPolicy.length,
    usedCheapFirst: 0,
    cheapFirstRate: 0,
    escalations: 0,
    escalationRate: 0,
    avgEstimatedSavingsUSD: 0,
    avgEstimatedSavingsPct: 0,
    avgRealizedTotalCostUSD: 0,
    avgFinalScore: 0,
  };

  const gateRejectionTotals: GateRejectionCounts = { savingsPct: 0, confidence: 0, gap: 0, noPromotionTarget: 0, budget: 0 };
  const gateRejectionByTaskType: Record<string, GateRejectionCounts> = {};
  const gateRejectionByDifficulty: Record<string, GateRejectionCounts> = {};
  const gateReasonCounts: Record<string, number> = {};
  const primaryBlockerTotals: Record<string, number> = {};
  const primaryBlockerByTaskType: Record<string, Record<string, number>> = {};
  const primaryBlockerByDifficulty: Record<string, Record<string, number>> = {};

  function incPrimaryBlocker(
    blocker: string,
    tt: string,
    diff: string
  ): void {
    primaryBlockerTotals[blocker] = (primaryBlockerTotals[blocker] ?? 0) + 1;
    if (!primaryBlockerByTaskType[tt]) primaryBlockerByTaskType[tt] = {};
    primaryBlockerByTaskType[tt][blocker] = (primaryBlockerByTaskType[tt][blocker] ?? 0) + 1;
    if (!primaryBlockerByDifficulty[diff]) primaryBlockerByDifficulty[diff] = {};
    primaryBlockerByDifficulty[diff][blocker] = (primaryBlockerByDifficulty[diff][blocker] ?? 0) + 1;
  }

  if (withPolicy.length === 0) {
    return {
      totals,
      byTaskType: {},
      byDifficulty: {},
      regret: { count: 0, examples: [] },
      economicRegret: { count: 0, examples: [] },
      gateRejectionCounts: { totals: gateRejectionTotals, byTaskType: {}, byDifficulty: {} },
      gateReasonCounts: {},
      primaryBlockerCounts: { totals: {}, byTaskType: {}, byDifficulty: {} },
    };
  }

  let sumSavingsUSD = 0;
  let sumSavingsPct = 0;
  let sumRealizedCost = 0;
  let sumFinalScore = 0;
  let countRealizedCost = 0;
  let countFinalScore = 0;

  const byTaskType: Record<string, { runs: number; cheapFirst: number; escalations: number; sumSavings: number; sumCost: number; sumScore: number; countCost: number; countScore: number }> = {};
  const byDifficulty: Record<string, { runs: number; cheapFirst: number; escalations: number; sumSavings: number; sumCost: number; sumScore: number; countCost: number; countScore: number }> = {};

  for (const e of withPolicy) {
    const pe = e.policyEval!;
    if (pe.usedCheapFirst) totals.usedCheapFirst++;
    if (pe.result.escalationUsed) totals.escalations++;

    sumSavingsUSD += pe.estimatedSavingsUSD;
    sumSavingsPct += pe.estimatedSavingsPct;
    if (pe.result.realizedTotalCostUSD != null) {
      sumRealizedCost += pe.result.realizedTotalCostUSD;
      countRealizedCost++;
    }
    if (pe.result.finalScore != null) {
      sumFinalScore += pe.result.finalScore;
      countFinalScore++;
    }

    const tt = pe.taskType;
    const diff = pe.difficulty;
    if (!byTaskType[tt]) byTaskType[tt] = { runs: 0, cheapFirst: 0, escalations: 0, sumSavings: 0, sumCost: 0, sumScore: 0, countCost: 0, countScore: 0 };
    byTaskType[tt].runs++;
    if (pe.usedCheapFirst) byTaskType[tt].cheapFirst++;
    if (pe.result.escalationUsed) byTaskType[tt].escalations++;
    byTaskType[tt].sumSavings += pe.estimatedSavingsUSD;
    if (pe.result.realizedTotalCostUSD != null) {
      byTaskType[tt].sumCost += pe.result.realizedTotalCostUSD;
      byTaskType[tt].countCost++;
    }
    if (pe.result.finalScore != null) {
      byTaskType[tt].sumScore += pe.result.finalScore;
      byTaskType[tt].countScore++;
    }

    if (!byDifficulty[diff]) byDifficulty[diff] = { runs: 0, cheapFirst: 0, escalations: 0, sumSavings: 0, sumCost: 0, sumScore: 0, countCost: 0, countScore: 0 };
    byDifficulty[diff].runs++;
    if (pe.usedCheapFirst) byDifficulty[diff].cheapFirst++;
    if (pe.result.escalationUsed) byDifficulty[diff].escalations++;
    byDifficulty[diff].sumSavings += pe.estimatedSavingsUSD;
    if (pe.result.realizedTotalCostUSD != null) {
      byDifficulty[diff].sumCost += pe.result.realizedTotalCostUSD;
      byDifficulty[diff].countCost++;
    }
    if (pe.result.finalScore != null) {
      byDifficulty[diff].sumScore += pe.result.finalScore;
      byDifficulty[diff].countScore++;
    }

    if (!pe.usedCheapFirst && pe.primaryBlocker) {
      incPrimaryBlocker(pe.primaryBlocker, tt, diff);
    }
    if (!pe.usedCheapFirst && pe.gateReason) {
      gateReasonCounts[pe.gateReason] = (gateReasonCounts[pe.gateReason] ?? 0) + 1;
    }
    if (!pe.usedCheapFirst && pe.gateRejectionCounts) {
      const grc = pe.gateRejectionCounts;
      gateRejectionTotals.savingsPct += grc.savingsPct;
      gateRejectionTotals.confidence += grc.confidence;
      gateRejectionTotals.gap += grc.gap;
      gateRejectionTotals.noPromotionTarget += grc.noPromotionTarget;
      gateRejectionTotals.budget += grc.budget;
      if (!gateRejectionByTaskType[tt]) gateRejectionByTaskType[tt] = { savingsPct: 0, confidence: 0, gap: 0, noPromotionTarget: 0, budget: 0 };
      gateRejectionByTaskType[tt].savingsPct += grc.savingsPct;
      gateRejectionByTaskType[tt].confidence += grc.confidence;
      gateRejectionByTaskType[tt].gap += grc.gap;
      gateRejectionByTaskType[tt].noPromotionTarget += grc.noPromotionTarget;
      gateRejectionByTaskType[tt].budget += grc.budget;
      if (!gateRejectionByDifficulty[diff]) gateRejectionByDifficulty[diff] = { savingsPct: 0, confidence: 0, gap: 0, noPromotionTarget: 0, budget: 0 };
      gateRejectionByDifficulty[diff].savingsPct += grc.savingsPct;
      gateRejectionByDifficulty[diff].confidence += grc.confidence;
      gateRejectionByDifficulty[diff].gap += grc.gap;
      gateRejectionByDifficulty[diff].noPromotionTarget += grc.noPromotionTarget;
      gateRejectionByDifficulty[diff].budget += grc.budget;
    }
  }

  totals.cheapFirstRate = totals.runs > 0 ? totals.usedCheapFirst / totals.runs : 0;
  totals.escalationRate = totals.runs > 0 ? totals.escalations / totals.runs : 0;
  totals.avgEstimatedSavingsUSD = totals.runs > 0 ? sumSavingsUSD / totals.runs : 0;
  totals.avgEstimatedSavingsPct = totals.runs > 0 ? sumSavingsPct / totals.runs : 0;
  totals.avgRealizedTotalCostUSD = countRealizedCost > 0 ? sumRealizedCost / countRealizedCost : 0;
  totals.avgFinalScore = countFinalScore > 0 ? sumFinalScore / countFinalScore : 0;

  const byTaskTypeOut: Record<string, PolicyStatsSlice> = {};
  for (const [tt, s] of Object.entries(byTaskType)) {
    byTaskTypeOut[tt] = {
      runs: s.runs,
      cheapFirstRate: s.runs > 0 ? s.cheapFirst / s.runs : 0,
      escalationRate: s.runs > 0 ? s.escalations / s.runs : 0,
      avgSavingsUSD: s.runs > 0 ? s.sumSavings / s.runs : 0,
      avgRealizedCostUSD: s.countCost > 0 ? s.sumCost / s.countCost : 0,
      avgFinalScore: s.countScore > 0 ? s.sumScore / s.countScore : 0,
    };
  }

  const byDifficultyOut: Record<string, PolicyStatsSlice> = {};
  for (const [d, s] of Object.entries(byDifficulty)) {
    byDifficultyOut[d] = {
      runs: s.runs,
      cheapFirstRate: s.runs > 0 ? s.cheapFirst / s.runs : 0,
      escalationRate: s.runs > 0 ? s.escalations / s.runs : 0,
      avgSavingsUSD: s.runs > 0 ? s.sumSavings / s.runs : 0,
      avgRealizedCostUSD: s.countCost > 0 ? s.sumCost / s.countCost : 0,
      avgFinalScore: s.countScore > 0 ? s.sumScore / s.countScore : 0,
    };
  }

  const regretEvents = withPolicy.filter(isRegret);
  const examples: PolicyRegretExample[] = regretEvents
    .slice(-20)
    .reverse()
    .map((e) => {
      const pe = e.policyEval!;
      return {
        runId: e.runId,
        taskType: pe.taskType,
        difficulty: pe.difficulty,
        normalChoiceModelId: pe.normalChoice.modelId,
        chosenAttempt1ModelId: pe.chosenAttempt1.modelId,
        finalModelId: pe.result.finalModelId,
        escalationUsed: pe.result.escalationUsed,
        finalScore: pe.result.finalScore,
        targetScore: pe.result.targetScore,
        realizedTotalCostUSD: pe.result.realizedTotalCostUSD,
        estimatedSavingsUSD: pe.estimatedSavingsUSD,
      };
    });

  const economicRegretEvents = withPolicy.filter(isEconomicRegret);
  const economicExamples: PolicyEconomicRegretExample[] = economicRegretEvents
    .slice(-20)
    .reverse()
    .map((e) => {
      const pe = e.policyEval!;
      return {
        runId: e.runId,
        taskType: pe.taskType,
        difficulty: pe.difficulty,
        normalChoiceModelId: pe.normalChoice.modelId,
        chosenAttempt1ModelId: pe.chosenAttempt1.modelId,
        finalModelId: pe.result.finalModelId,
        escalationUsed: pe.result.escalationUsed,
        finalScore: pe.result.finalScore,
        targetScore: pe.result.targetScore,
        realizedTotalCostUSD: pe.result.realizedTotalCostUSD,
        estimatedSavingsUSD: pe.estimatedSavingsUSD,
        normalChoiceExpectedCostUSD: pe.normalChoice.expectedCostUSD,
      };
    });

  return {
    totals,
    byTaskType: byTaskTypeOut,
    byDifficulty: byDifficultyOut,
    regret: { count: regretEvents.length, examples },
    economicRegret: { count: economicRegretEvents.length, examples: economicExamples },
    gateRejectionCounts: {
      totals: gateRejectionTotals,
      byTaskType: gateRejectionByTaskType,
      byDifficulty: gateRejectionByDifficulty,
    },
    gateReasonCounts,
    primaryBlockerCounts: {
      totals: primaryBlockerTotals,
      byTaskType: primaryBlockerByTaskType,
      byDifficulty: primaryBlockerByDifficulty,
    },
  };
}
