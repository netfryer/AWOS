/**
 * Director QA policy selection. Deterministic rules for when to run
 * deterministic vs LLM QA; no LLM calls.
 */

// ─── src/lib/planning/directorQaPolicy.ts ───────────────────────────────────

export interface QaPolicy {
  deterministicFirst: boolean;
  llmSecondPassImportanceThreshold: number;
  skipLlmOnPass: boolean;
  alwaysLlmForHighRisk: boolean;
}

export interface ChooseQaPolicyArgs {
  importance: number;
  difficulty: "low" | "medium" | "high";
  hasDeterministicChecks: boolean;
  riskScore: number;
}

/**
 * Chooses QA policy based on importance, difficulty, deterministic checks, and risk.
 * Deterministic; no LLM calls.
 */
export function chooseQaPolicy(args: ChooseQaPolicyArgs): QaPolicy {
  const { importance, hasDeterministicChecks, riskScore } = args;

  const deterministicFirst = importance >= 4 && hasDeterministicChecks;
  const llmSecondPassImportanceThreshold = 4;
  const skipLlmOnPass = importance <= 3;
  const alwaysLlmForHighRisk =
    riskScore >= 0.6 && importance >= 4;

  return {
    deterministicFirst,
    llmSecondPassImportanceThreshold,
    skipLlmOnPass,
    alwaysLlmForHighRisk,
  };
}
