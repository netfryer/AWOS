#!/usr/bin/env node
/**
 * Run policy eval batch: 30 runs (10 code, 10 writing, 10 analysis)
 * with best_value, promote_on_low_score, escalation_aware.
 * Uses both fast and strict profiles.
 *
 * Requires dev server: npm run dev:ui (or next dev) must be running.
 * Usage: npx tsx scripts/runPolicyEvalBatch.ts
 */

const BASE = process.env.POLICY_EVAL_BASE_URL ?? "http://localhost:3000";

/** Optional gap override for A/B testing. E.g. CHEAP_FIRST_GAP_HIGH=0.12 */
const GAP_OVERRIDE =
  process.env.CHEAP_FIRST_GAP_HIGH != null
    ? { high: parseFloat(process.env.CHEAP_FIRST_GAP_HIGH) }
    : undefined;

/** Writing-only gap override. E.g. CHEAP_FIRST_GAP_HIGH_WRITING=0.12 */
const GAP_OVERRIDE_WRITING =
  process.env.CHEAP_FIRST_GAP_HIGH_WRITING != null
    ? { writing: { high: parseFloat(process.env.CHEAP_FIRST_GAP_HIGH_WRITING) } }
    : undefined;

/** Writing-only confidence/savings overrides. E.g. CHEAP_FIRST_MIN_CONFIDENCE_WRITING=0.25, CHEAP_FIRST_SAVINGS_MIN_PCT_WRITING=0.20 */
const OVERRIDES_WRITING =
  process.env.CHEAP_FIRST_MIN_CONFIDENCE_WRITING != null ||
  process.env.CHEAP_FIRST_SAVINGS_MIN_PCT_WRITING != null
    ? {
        writing: {
          ...(process.env.CHEAP_FIRST_MIN_CONFIDENCE_WRITING != null
            ? { minConfidence: parseFloat(process.env.CHEAP_FIRST_MIN_CONFIDENCE_WRITING) }
            : {}),
          ...(process.env.CHEAP_FIRST_SAVINGS_MIN_PCT_WRITING != null
            ? { savingsMinPct: parseFloat(process.env.CHEAP_FIRST_SAVINGS_MIN_PCT_WRITING) }
            : {}),
        },
      }
    : undefined;

const DIRECTIVES = {
  code: "Write a JavaScript function that validates an email address with a regex and includes 3 example calls.",
  writing: "Write a 200-word professional launch announcement for an AI productivity platform, with a headline and 3 bullet features.",
  analysis: "Provide a structured 8-bullet risk analysis of deploying autonomous AI agents in enterprise IT, with mitigations.",
};

const BATCH = [
  { taskType: "code" as const, difficulty: "medium" as const, profile: "fast" as const, count: 5 },
  { taskType: "code" as const, difficulty: "medium" as const, profile: "strict" as const, count: 5 },
  { taskType: "writing" as const, difficulty: "high" as const, profile: "fast" as const, count: 5 },
  { taskType: "writing" as const, difficulty: "high" as const, profile: "strict" as const, count: 5 },
  { taskType: "analysis" as const, difficulty: "high" as const, profile: "fast" as const, count: 5 },
  { taskType: "analysis" as const, difficulty: "high" as const, profile: "strict" as const, count: 5 },
];

async function runOne(payload: Record<string, unknown>): Promise<{ ok: boolean; policyEval?: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { policyEval?: { enabled?: boolean }; final?: { status?: string }; error?: string };
    if (!res.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: data.final?.status === "ok",
      policyEval: data.policyEval?.enabled === true,
      error: data.error,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  console.log(`Running policy eval batch against ${BASE}\n`);
  console.log(
    `Config: selectionPolicy=best_value, escalation=promote_on_low_score, routingMode=escalation_aware${GAP_OVERRIDE ? `, gapOverride=${JSON.stringify(GAP_OVERRIDE)}` : ""}${GAP_OVERRIDE_WRITING ? `, gapOverrideByTaskType=${JSON.stringify(GAP_OVERRIDE_WRITING)}` : ""}${OVERRIDES_WRITING ? `, cheapFirstOverridesByTaskType=${JSON.stringify(OVERRIDES_WRITING)}` : ""}\n`
  );

  let totalOk = 0;
  let totalPolicyEval = 0;

  for (const { taskType, difficulty, profile, count } of BATCH) {
    const directive = DIRECTIVES[taskType];
    const payload: Record<string, unknown> = {
      directive,
      taskType,
      difficulty,
      profile,
      selectionPolicyOverride: "best_value",
      escalationPolicyOverride: "promote_on_low_score",
      escalationRoutingModeOverride: "escalation_aware",
    };
    if (GAP_OVERRIDE) payload.cheapFirstMaxGapOverride = GAP_OVERRIDE;
    if (GAP_OVERRIDE_WRITING) payload.cheapFirstMaxGapOverrideByTaskType = GAP_OVERRIDE_WRITING;
    if (OVERRIDES_WRITING) payload.cheapFirstOverridesByTaskType = OVERRIDES_WRITING;
    console.log(`--- ${taskType} / ${difficulty} / ${profile} (${count} runs) ---`);
    let ok = 0;
    let withPolicy = 0;
    for (let i = 0; i < count; i++) {
      const result = await runOne(payload);
      if (result.ok) ok++;
      if (result.policyEval) withPolicy++;
      process.stdout.write(result.ok ? "." : "x");
    }
    console.log(` ${ok}/${count} ok, ${withPolicy} with policyEval\n`);
    totalOk += ok;
    totalPolicyEval += withPolicy;
  }

  console.log(`Total: ${totalOk}/30 ok, ${totalPolicyEval} with policyEval`);
  console.log("\nDone. Check GET /api/stats/policy for aggregates.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
