#!/usr/bin/env node
/**
 * Run a small, focused writing/high policy eval batch.
 * 10–15 writing/high runs with evaluationMode="focused" (cheapFirstEvalRate=1.0, normalEvalRate=0.25).
 * No knob changes — baseline to read primaryBlockerCounts.
 *
 * Requires dev server: npm run dev:ui (or next dev) must be running.
 * Usage: npx tsx scripts/runPolicyEvalBatchWritingFocused.ts
 */

const BASE = process.env.POLICY_EVAL_BASE_URL ?? "http://localhost:3000";
const COUNT = parseInt(process.env.POLICY_EVAL_WRITING_COUNT ?? "12", 10) || 12;

const DIRECTIVE =
  "Write a 200-word professional launch announcement for an AI productivity platform, with a headline and 3 bullet features.";

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
  console.log(`Running writing/high policy eval batch (${COUNT} runs) against ${BASE}\n`);
  console.log(
    `Config: writing/high, evaluationMode=focused (cheapFirstEvalRate=1.0, normalEvalRate=0.25), no knob overrides\n`
  );

  const payload: Record<string, unknown> = {
    directive: DIRECTIVE,
    taskType: "writing",
    difficulty: "high",
    profile: "fast",
    selectionPolicyOverride: "best_value",
    escalationPolicyOverride: "promote_on_low_score",
    escalationRoutingModeOverride: "escalation_aware",
    escalationEvaluationModeOverride: "focused",
    escalationCheapFirstEvalRateOverride: 1.0,
    escalationNormalEvalRateOverride: 0.25,
  };

  let ok = 0;
  let withPolicy = 0;
  for (let i = 0; i < COUNT; i++) {
    const result = await runOne(payload);
    if (result.ok) ok++;
    if (result.policyEval) withPolicy++;
    process.stdout.write(result.ok ? "." : "x");
  }

  console.log(`\n\n${ok}/${COUNT} ok, ${withPolicy} with policyEval`);
  console.log("\nDone. Fetch:");
  console.log("  GET /api/stats/policy");
  console.log("  GET /api/stats/policy/optimize");
  console.log("\nCheck primaryBlockerCounts.byTaskType.writing for the dominant blocker.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
