/**
 * Stage 6: Policy Optimizer.
 * Pure deterministic function: stats + config → recommendations.
 * Advisory only; does not auto-apply changes.
 */

import type { EscalationConfig } from "../types.js";
import type { Difficulty } from "../types.js";
import type {
  PolicyStatsInput,
  PolicyRecommendation,
  PolicyOptimizerResult,
  PolicyHealth,
  RecommendationConfidence,
} from "./types.js";

function confidenceFromRuns(n: number): RecommendationConfidence {
  if (n <= 20) return "low";
  if (n <= 49) return "medium";
  return "high";
}

const DEFAULT_GAP: Record<Difficulty, number> = {
  low: 0.06,
  medium: 0.08,
  high: 0.1,
};

const CLAMP = {
  cheapFirstSavingsMinPct: { min: 0.05, max: 0.8 },
  cheapFirstMinConfidence: { min: 0.1, max: 0.9 },
  cheapFirstMaxGap: { min: 0.02, max: 0.2 },
  promotionMargin: { min: 0.01, max: 0.1 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getGap(config: EscalationConfig, d: Difficulty): number {
  return config.cheapFirstMaxGapByDifficulty?.[d] ?? DEFAULT_GAP[d];
}

/** Stage 6.3: Dominant primary blocker from counts. Returns null if empty. */
function dominantBlocker(counts: Record<string, number> | undefined): string | null {
  if (!counts || Object.keys(counts).length === 0) return null;
  let max = 0;
  let blocker: string | null = null;
  for (const [k, v] of Object.entries(counts)) {
    if (v > max) {
      max = v;
      blocker = k;
    }
  }
  return blocker;
}

/** Maps primaryBlocker to the parameter we should recommend for loosening. */
function blockerToLoosenParameter(blocker: string): "cheapFirstSavingsMinPct" | "cheapFirstMinConfidence" | "cheapFirstMaxGapByDifficulty" | null {
  if (blocker === "savingsPct" || blocker === "no_cheap_first_candidates") return "cheapFirstSavingsMinPct";
  if (blocker === "confidence") return "cheapFirstMinConfidence";
  if (blocker === "gap") return "cheapFirstMaxGapByDifficulty";
  return null;
}

function addRecommendation(
  recs: PolicyRecommendation[],
  rec: PolicyRecommendation,
  key: string
): void {
  if (recs.some((r) => `${r.parameter}:${r.target ?? ""}` === key)) return;
  const rounded: PolicyRecommendation = {
    ...rec,
    suggestedValue: round3(rec.suggestedValue),
    ...(rec.currentValue != null ? { currentValue: round3(rec.currentValue) } : {}),
  };
  recs.push(rounded);
}

export function optimizePolicy(
  stats: PolicyStatsInput,
  currentConfig: EscalationConfig
): PolicyOptimizerResult {
  const recommendations: PolicyRecommendation[] = [];
  let health: PolicyHealth = "healthy";

  const { totals, byTaskType, byDifficulty, regret, economicRegret, primaryBlockerCounts } = stats;
  const cfRate = totals.cheapFirstRate;
  const escRate = totals.escalationRate;
  const regretCount = regret.count;
  const economicRegretCount = economicRegret.count;

  const currentMinConf = currentConfig.cheapFirstMinConfidence ?? 0.4;
  const currentSavingsPct = currentConfig.cheapFirstSavingsMinPct ?? 0.3;

  // 1) Insufficient data
  if (totals.runs < 20) {
    return {
      summary: "Insufficient data for confident optimization. Run at least 20 policy-eval runs.",
      health: "healthy",
      recommendations: [
        {
          severity: "info",
          scope: "global",
          parameter: "cheapFirstMinConfidence",
          suggestedValue: round3(currentMinConf),
          rationale: "Need at least 20 runs with policyEval to produce tuning recommendations.",
          expectedImpact: "Run npm run policy:eval-batch and re-check.",
          evidenceRuns: totals.runs,
          confidence: confidenceFromRuns(totals.runs),
        },
      ],
    };
  }

  // 2) Regret > 0 → aggressive
  if (regretCount > 0) {
    health = "aggressive";
    const newMinConf = clamp(currentMinConf + 0.05, CLAMP.cheapFirstMinConfidence.min, CLAMP.cheapFirstMinConfidence.max);
    addRecommendation(
      recommendations,
      {
        severity: "warning",
        scope: "global",
        parameter: "cheapFirstMinConfidence",
        currentValue: currentMinConf,
        suggestedValue: newMinConf,
        rationale: `Quality regret detected (${regretCount} runs). Cheap-first picked models that underperformed without escalating.`,
        expectedImpact: "Raising min confidence will reduce cheap-first picks on uncertain lanes.",
        evidenceRuns: totals.runs,
        confidence: confidenceFromRuns(totals.runs),
      },
      "cheapFirstMinConfidence:"
    );

    const highGap = getGap(currentConfig, "high");
    const newHighGap = clamp(highGap - 0.02, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
    addRecommendation(
      recommendations,
      {
        severity: "warning",
        scope: "difficulty",
        target: "high",
        parameter: "cheapFirstMaxGapByDifficulty",
        currentValue: highGap,
        suggestedValue: newHighGap,
        rationale: `Quality regret with cheap-first. Tightening high-difficulty gap reduces near-threshold picks.`,
        expectedImpact: "Fewer cheap-first picks on high-difficulty tasks.",
        evidenceRuns: byDifficulty.high?.runs ?? totals.runs,
        confidence: confidenceFromRuns(byDifficulty.high?.runs ?? totals.runs),
      },
      "cheapFirstMaxGapByDifficulty:high"
    );
  }

  // 3) Economic regret > 0 → aggressive
  if (economicRegretCount > 0) {
    health = "aggressive";
    const newSavingsPct = clamp(
      currentSavingsPct + 0.05,
      CLAMP.cheapFirstSavingsMinPct.min,
      CLAMP.cheapFirstSavingsMinPct.max
    );
    addRecommendation(
      recommendations,
      {
        severity: "warning",
        scope: "global",
        parameter: "cheapFirstSavingsMinPct",
        currentValue: currentSavingsPct,
        suggestedValue: newSavingsPct,
        rationale: `Economic regret: ${economicRegretCount} runs where escalation cost more than normal choice.`,
        expectedImpact: "Require larger savings to justify cheap-first; reduces over-escalation.",
        evidenceRuns: totals.runs,
        confidence: confidenceFromRuns(totals.runs),
      },
      "cheapFirstSavingsMinPct:"
    );
  }

  // 4) Conservative: cheapFirstRate < 0.15, no regret
  // Stage 6.3: Use primaryBlockerCounts to target the dominant blocker; avoid recommending gap when blocker is savings/confidence
  if (cfRate < 0.15 && regretCount === 0) {
    if (health === "healthy") health = "conservative";
    const domBlocker = dominantBlocker(primaryBlockerCounts?.totals);
    const param = domBlocker ? blockerToLoosenParameter(domBlocker) : null;

    if (param === "cheapFirstMaxGapByDifficulty" || (!param && !domBlocker)) {
      const medGap = getGap(currentConfig, "medium");
      const newMedGap = clamp(medGap + 0.02, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
      addRecommendation(
        recommendations,
        {
          severity: "adjust",
          scope: "difficulty",
          target: "medium",
          parameter: "cheapFirstMaxGapByDifficulty",
          currentValue: medGap,
          suggestedValue: newMedGap,
          rationale: `Cheap-first rate is ${(cfRate * 100).toFixed(1)}% with zero regret. Gates may be too strict.${domBlocker === "gap" ? " Primary blocker: gap." : ""}`,
          expectedImpact: "Loosening medium-difficulty gap may increase cost efficiency.",
          evidenceRuns: byDifficulty.medium?.runs ?? totals.runs,
          confidence: confidenceFromRuns(byDifficulty.medium?.runs ?? totals.runs),
        },
        "cheapFirstMaxGapByDifficulty:medium"
      );
    }

    if (param === "cheapFirstSavingsMinPct" || param === "cheapFirstMinConfidence" || (!param && !domBlocker)) {
      if (param === "cheapFirstSavingsMinPct" || !param) {
        const newSavingsPct = clamp(
          currentSavingsPct - 0.05,
          CLAMP.cheapFirstSavingsMinPct.min,
          CLAMP.cheapFirstSavingsMinPct.max
        );
        addRecommendation(
          recommendations,
          {
            severity: "adjust",
            scope: "global",
            parameter: "cheapFirstSavingsMinPct",
            currentValue: currentSavingsPct,
            suggestedValue: newSavingsPct,
            rationale: `Conservative cheap-first rate. Lower savings threshold may allow more cheap picks.${domBlocker === "savingsPct" || domBlocker === "no_cheap_first_candidates" ? " Primary blocker: savings." : ""}`,
            expectedImpact: "More cheap-first opportunities when savings are modest.",
            evidenceRuns: totals.runs,
            confidence: confidenceFromRuns(totals.runs),
          },
          "cheapFirstSavingsMinPct:"
        );
      }
      if (param === "cheapFirstMinConfidence") {
        const newMinConf = clamp(currentMinConf - 0.05, CLAMP.cheapFirstMinConfidence.min, CLAMP.cheapFirstMinConfidence.max);
        addRecommendation(
          recommendations,
          {
            severity: "adjust",
            scope: "global",
            parameter: "cheapFirstMinConfidence",
            currentValue: currentMinConf,
            suggestedValue: newMinConf,
            rationale: `Conservative cheap-first rate. Primary blocker: confidence. Lower min confidence may allow more cheap picks (accept lower-data trust).`,
            expectedImpact: "More cheap-first opportunities when confidence is borderline.",
            evidenceRuns: totals.runs,
            confidence: confidenceFromRuns(totals.runs),
          },
          "cheapFirstMinConfidence:loosen"
        );
      }
    }
  }

  // 5) cheapFirstRate > 0.65 → aggressive
  if (cfRate > 0.65) {
    if (health === "healthy") health = "aggressive";
    const newMinConf = clamp(currentMinConf + 0.05, CLAMP.cheapFirstMinConfidence.min, CLAMP.cheapFirstMinConfidence.max);
    addRecommendation(
      recommendations,
      {
        severity: "adjust",
        scope: "global",
        parameter: "cheapFirstMinConfidence",
        currentValue: currentMinConf,
        suggestedValue: newMinConf,
        rationale: `Cheap-first rate is ${(cfRate * 100).toFixed(1)}%. May be over-picking cheap models.`,
        expectedImpact: "Higher confidence gate reduces cheap-first on uncertain lanes.",
        evidenceRuns: totals.runs,
        confidence: confidenceFromRuns(totals.runs),
      },
      "cheapFirstMinConfidence:"
    );
  }

  // 6) escalationRate > 0.30
  if (escRate > 0.3) {
    const highGap = getGap(currentConfig, "high");
    const newHighGap = clamp(highGap - 0.02, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
    addRecommendation(
      recommendations,
      {
        severity: "adjust",
        scope: "difficulty",
        target: "high",
        parameter: "cheapFirstMaxGapByDifficulty",
        currentValue: highGap,
        suggestedValue: newHighGap,
        rationale: `Escalation rate is ${(escRate * 100).toFixed(1)}%. Cheap-first may be picking too-weak models.`,
        expectedImpact: "Tightening high-difficulty gap reduces near-threshold cheap picks.",
        evidenceRuns: byDifficulty.high?.runs ?? totals.runs,
        confidence: confidenceFromRuns(byDifficulty.high?.runs ?? totals.runs),
      },
      "cheapFirstMaxGapByDifficulty:high"
    );
  }

  // 7) escalationRate < 0.05 AND cheapFirstRate > 0.40 → overly safe
  if (escRate < 0.05 && cfRate > 0.4) {
    const highGap = getGap(currentConfig, "high");
    const newHighGap = clamp(highGap + 0.01, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
    addRecommendation(
      recommendations,
      {
        severity: "info",
        scope: "difficulty",
        target: "high",
        parameter: "cheapFirstMaxGapByDifficulty",
        currentValue: highGap,
        suggestedValue: newHighGap,
        rationale: "Low escalation with healthy cheap-first rate. System may be overly safe; slight loosen optional.",
        expectedImpact: "Minor increase in cheap-first opportunities on high-difficulty tasks.",
        evidenceRuns: byDifficulty.high?.runs ?? totals.runs,
        confidence: confidenceFromRuns(byDifficulty.high?.runs ?? totals.runs),
      },
      "cheapFirstMaxGapByDifficulty:high"
    );
  }

  // TASK-TYPE SIGNALS
  // Use "adjust" only when strong signal: regret, economicRegret, global cfRate out of bounds, or slice runs >= 30
  const taskTypeStrongSignal =
    regretCount > 0 ||
    economicRegretCount > 0 ||
    cfRate < 0.15 ||
    cfRate > 0.65;

  for (const [taskType, slice] of Object.entries(byTaskType)) {
    if (slice.runs < 10) continue;
    const ttCfRate = slice.cheapFirstRate;
    const ttEscRate = slice.escalationRate;
    const ttSeverity = taskTypeStrongSignal || slice.runs >= 30 ? "adjust" : "info";

    // Stage 6.3: Use primaryBlockerCounts to target the real blocker; don't recommend gap when blocker is savings/confidence
    if (ttCfRate === 0 && ttEscRate > 0.3) {
      const ttBlockers = primaryBlockerCounts?.byTaskType?.[taskType];
      const domBlocker = dominantBlocker(ttBlockers);
      const param = domBlocker ? blockerToLoosenParameter(domBlocker) : "cheapFirstMaxGapByDifficulty";

      if (param === "cheapFirstMaxGapByDifficulty") {
        const highGap = getGap(currentConfig, "high");
        const newHighGap = clamp(highGap + 0.02, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
        addRecommendation(
          recommendations,
          {
            severity: ttSeverity,
            scope: "taskType",
            target: taskType,
            parameter: "cheapFirstMaxGapByDifficulty",
            currentValue: highGap,
            suggestedValue: newHighGap,
            rationale: `Task type "${taskType}": cheap-first never used but escalation rate ${(ttEscRate * 100).toFixed(0)}%. Primary blocker: gap. Consider loosening.`,
            expectedImpact: `May allow cheap-first for ${taskType} when near threshold.`,
            evidenceRuns: slice.runs,
            confidence: confidenceFromRuns(slice.runs),
          },
          `cheapFirstMaxGapByDifficulty:${taskType}`
        );
      } else if (param === "cheapFirstSavingsMinPct") {
        const newSavingsPct = clamp(
          currentSavingsPct - 0.05,
          CLAMP.cheapFirstSavingsMinPct.min,
          CLAMP.cheapFirstSavingsMinPct.max
        );
        addRecommendation(
          recommendations,
          {
            severity: ttSeverity,
            scope: "taskType",
            target: taskType,
            parameter: "cheapFirstSavingsMinPct",
            currentValue: currentSavingsPct,
            suggestedValue: newSavingsPct,
            rationale: `Task type "${taskType}": cheap-first never used but escalation rate ${(ttEscRate * 100).toFixed(0)}%. Primary blocker: savings. Lower savings threshold for ${taskType}.`,
            expectedImpact: `May allow cheap-first for ${taskType} when savings are modest.`,
            evidenceRuns: slice.runs,
            confidence: confidenceFromRuns(slice.runs),
          },
          `cheapFirstSavingsMinPct:${taskType}`
        );
      } else if (param === "cheapFirstMinConfidence") {
        const newMinConf = clamp(currentMinConf - 0.05, CLAMP.cheapFirstMinConfidence.min, CLAMP.cheapFirstMinConfidence.max);
        addRecommendation(
          recommendations,
          {
            severity: ttSeverity,
            scope: "taskType",
            target: taskType,
            parameter: "cheapFirstMinConfidence",
            currentValue: currentMinConf,
            suggestedValue: newMinConf,
            rationale: `Task type "${taskType}": cheap-first never used but escalation rate ${(ttEscRate * 100).toFixed(0)}%. Primary blocker: confidence. Lower min confidence (accept lower-data trust).`,
            expectedImpact: `May allow cheap-first for ${taskType} when confidence is borderline.`,
            evidenceRuns: slice.runs,
            confidence: confidenceFromRuns(slice.runs),
          },
          `cheapFirstMinConfidence:${taskType}`
        );
      }
    }

    if (ttCfRate > 0.5 && ttEscRate > 0.3) {
      const highGap = getGap(currentConfig, "high");
      const newHighGap = clamp(highGap - 0.02, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
      addRecommendation(
        recommendations,
        {
          severity: ttSeverity,
          scope: "taskType",
          target: taskType,
          parameter: "cheapFirstMaxGapByDifficulty",
          currentValue: highGap,
          suggestedValue: newHighGap,
          rationale: `Task type "${taskType}": high cheap-first (${(ttCfRate * 100).toFixed(0)}%) with high escalation (${(ttEscRate * 100).toFixed(0)}%). Tighten gap.`,
          expectedImpact: `Reduce cheap-first for ${taskType} when near threshold.`,
          evidenceRuns: slice.runs,
          confidence: confidenceFromRuns(slice.runs),
        },
        `cheapFirstMaxGapByDifficulty:${taskType}-tighten`
      );
    }
  }

  // DIFFICULTY SIGNALS (high)
  const highSlice = byDifficulty.high;
  if (highSlice && highSlice.runs >= 10) {
    const hCfRate = highSlice.cheapFirstRate;
    const hEscRate = highSlice.escalationRate;

    if (hCfRate > 0.3 && hEscRate > 0.25) {
      const highGap = getGap(currentConfig, "high");
      const newHighGap = clamp(highGap - 0.02, CLAMP.cheapFirstMaxGap.min, CLAMP.cheapFirstMaxGap.max);
      addRecommendation(
        recommendations,
        {
          severity: "adjust",
          scope: "difficulty",
          target: "high",
          parameter: "cheapFirstMaxGapByDifficulty",
          currentValue: highGap,
          suggestedValue: newHighGap,
          rationale: `High difficulty: cheap-first ${(hCfRate * 100).toFixed(0)}% with escalation ${(hEscRate * 100).toFixed(0)}%. Tighten gap.`,
          expectedImpact: "Fewer near-threshold cheap picks on high-difficulty tasks.",
          evidenceRuns: highSlice.runs,
          confidence: confidenceFromRuns(highSlice.runs),
        },
        "cheapFirstMaxGapByDifficulty:high"
      );
    }
  }

  // Unstable: both regret and very high escalation
  if (regretCount > 0 && escRate > 0.25) {
    health = "unstable";
  }

  // Build summary
  let summary: string;
  if (health === "healthy" && recommendations.length === 0) {
    summary = `Policy is healthy. Cheap-first used on ${(cfRate * 100).toFixed(0)}% of runs with ${(escRate * 100).toFixed(0)}% escalation and zero regret. No adjustments required.`;
  } else if (health === "healthy" && recommendations.length > 0) {
    summary = `Policy is healthy. Cheap-first ${(cfRate * 100).toFixed(0)}%, escalation ${(escRate * 100).toFixed(0)}%, zero regret. ${recommendations.length} optional tuning suggestion(s).`;
  } else if (health === "conservative") {
    summary = `Policy is conservative. Cheap-first rate is ${(cfRate * 100).toFixed(1)}% with zero regret. Loosening gap and savings threshold may increase cost efficiency.`;
  } else if (health === "aggressive") {
    summary = `Policy is aggressive. ${regretCount > 0 ? `Quality regret: ${regretCount}. ` : ""}${economicRegretCount > 0 ? `Economic regret: ${economicRegretCount}. ` : ""}Tightening gates recommended.`;
  } else if (health === "unstable") {
    summary = `Policy is unstable. Regret and high escalation (${(escRate * 100).toFixed(0)}%) indicate gates need tightening.`;
  } else {
    summary = `Policy health: ${health}. ${recommendations.length} recommendation(s).`;
  }

  return {
    summary,
    health,
    recommendations,
  };
}
