#!/usr/bin/env node
/**
 * A/B test: baseline (gap 0.10) vs experimental (high gap 0.12).
 * Runs policy:eval-batch twice with different configs, compares stats.
 *
 * Requires dev server: npm run dev:ui
 * Usage: npx tsx scripts/runPolicyEvalAB.ts
 */

import { spawn } from "child_process";
import { writeFile, copyFile, mkdir } from "fs/promises";
import { join } from "path";

const BASE = process.env.POLICY_EVAL_BASE_URL ?? "http://localhost:3000";
const RUNS_DIR = join(process.cwd(), "runs");
const RUNS_FILE = join(RUNS_DIR, "runs.jsonl");

function runBatch(
  gapHigh?: number,
  gapHighWriting?: number,
  extraEnv?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    if (gapHigh != null) env.CHEAP_FIRST_GAP_HIGH = String(gapHigh);
    if (gapHighWriting != null) env.CHEAP_FIRST_GAP_HIGH_WRITING = String(gapHighWriting);
    const child = spawn("npm", ["run", "policy:eval-batch"], {
      stdio: "inherit",
      env,
      cwd: process.cwd(),
      shell: process.platform === "win32",
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Batch exited ${code}`))));
  });
}

async function fetchStats(): Promise<unknown> {
  const res = await fetch(`${BASE}/api/stats/policy`);
  if (!res.ok) throw new Error(`Stats API ${res.status}`);
  return res.json();
}

async function clearRuns(): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  await writeFile(RUNS_FILE, "", "utf-8");
}

const WRITING_ONLY = process.env.CHEAP_FIRST_AB_WRITING_ONLY === "1";
const WRITING_CONFIDENCE = process.env.CHEAP_FIRST_AB_WRITING_CONFIDENCE;
const WRITING_SAVINGS = process.env.CHEAP_FIRST_AB_WRITING_SAVINGS;

function getExperimentInfo(): { title: string; baselineLabel: string; expLabel: string; expEnv?: Record<string, string> } {
  if (WRITING_CONFIDENCE != null) {
    const val = parseFloat(WRITING_CONFIDENCE);
    return {
      title: `Writing-only confidence: 0.40 vs ${val} (CHEAP_FIRST_AB_WRITING_CONFIDENCE=${WRITING_CONFIDENCE})\n`,
      baselineLabel: "--- BASELINE (writing minConfidence 0.40) ---",
      expLabel: `--- EXPERIMENTAL (writing minConfidence ${val}) ---`,
      expEnv: { CHEAP_FIRST_MIN_CONFIDENCE_WRITING: WRITING_CONFIDENCE },
    };
  }
  if (WRITING_SAVINGS != null) {
    const val = parseFloat(WRITING_SAVINGS);
    return {
      title: `Writing-only savings: 0.30 vs ${val} (CHEAP_FIRST_AB_WRITING_SAVINGS=${WRITING_SAVINGS})\n`,
      baselineLabel: "--- BASELINE (writing savingsMinPct 0.30) ---",
      expLabel: `--- EXPERIMENTAL (writing savingsMinPct ${val}) ---`,
      expEnv: { CHEAP_FIRST_SAVINGS_MIN_PCT_WRITING: WRITING_SAVINGS },
    };
  }
  if (WRITING_ONLY) {
    return {
      title: "=== Policy Eval A/B: Writing-only gap 0.10 vs 0.12 (CHEAP_FIRST_AB_WRITING_ONLY=1) ===\n",
      baselineLabel: "--- BASELINE (writing gap high=0.10) ---",
      expLabel: "--- EXPERIMENTAL (writing gap high=0.12) ---",
      expEnv: undefined,
    };
  }
  return {
    title: "=== Policy Eval A/B: Baseline (gap 0.10) vs Experimental (high gap 0.12) ===\n",
    baselineLabel: "--- BASELINE (cheapFirstMaxGap high=0.10) ---",
    expLabel: "--- EXPERIMENTAL (cheapFirstMaxGap high=0.12) ---",
    expEnv: undefined,
  };
}

async function main(): Promise<void> {
  const expInfo = getExperimentInfo();
  console.log(expInfo.title);

  // Backup existing runs
  try {
    await copyFile(RUNS_FILE, join(RUNS_DIR, "runs_backup.jsonl"));
    console.log("Backed up runs.jsonl to runs_backup.jsonl\n");
  } catch {
    // No existing file
  }

  // Baseline
  console.log(expInfo.baselineLabel);
  await clearRuns();
  await runBatch(undefined, undefined);
  const baseline = (await fetchStats()) as {
    totals?: { cheapFirstRate?: number; escalationRate?: number; avgFinalScore?: number; avgRealizedTotalCostUSD?: number };
    byTaskType?: Record<string, { cheapFirstRate?: number; escalationRate?: number; avgRealizedCostUSD?: number }>;
    regret?: { count?: number };
    economicRegret?: { count?: number };
    gateRejectionCounts?: { totals?: { savingsPct?: number; confidence?: number; gap?: number; noPromotionTarget?: number; budget?: number }; byTaskType?: Record<string, { savingsPct?: number; confidence?: number; gap?: number; noPromotionTarget?: number; budget?: number }> };
    gateReasonCounts?: Record<string, number>;
  };
  console.log("\nBaseline stats captured.\n");

  // Experimental
  console.log(expInfo.expLabel);
  await clearRuns();
  await runBatch(
    WRITING_ONLY ? undefined : 0.12,
    WRITING_ONLY ? 0.12 : undefined,
    expInfo.expEnv
  );
  const experimental = (await fetchStats()) as {
    totals?: { cheapFirstRate?: number; escalationRate?: number; avgFinalScore?: number; avgRealizedTotalCostUSD?: number };
    byTaskType?: Record<string, { cheapFirstRate?: number; escalationRate?: number; avgRealizedCostUSD?: number }>;
    regret?: { count?: number };
    economicRegret?: { count?: number };
    gateRejectionCounts?: { totals?: { savingsPct?: number; confidence?: number; gap?: number; noPromotionTarget?: number; budget?: number }; byTaskType?: Record<string, { savingsPct?: number; confidence?: number; gap?: number; noPromotionTarget?: number; budget?: number }> };
    gateReasonCounts?: Record<string, number>;
  };
  console.log("\nExperimental stats captured.\n");

  // Compare
  console.log("=== COMPARISON ===\n");

  const wBase = baseline.byTaskType?.writing;
  const wExp = experimental.byTaskType?.writing;
  console.log("Writing:");
  console.log(`  cheapFirstRate:        ${((wBase?.cheapFirstRate ?? 0) * 100).toFixed(1)}% → ${((wExp?.cheapFirstRate ?? 0) * 100).toFixed(1)}%`);
  console.log(`  escalationRate:       ${((wBase?.escalationRate ?? 0) * 100).toFixed(1)}% → ${((wExp?.escalationRate ?? 0) * 100).toFixed(1)}%`);
  console.log(`  avgRealizedCostUSD:   $${(wBase?.avgRealizedCostUSD ?? 0).toFixed(4)} → $${(wExp?.avgRealizedCostUSD ?? 0).toFixed(4)}`);

  console.log("\nOverall:");
  console.log(`  regret:                ${baseline.regret?.count ?? 0} → ${experimental.regret?.count ?? 0}`);
  console.log(`  economicRegret:       ${baseline.economicRegret?.count ?? 0} → ${experimental.economicRegret?.count ?? 0}`);
  console.log(`  avgFinalScore:         ${(baseline.totals?.avgFinalScore ?? 0).toFixed(3)} → ${(experimental.totals?.avgFinalScore ?? 0).toFixed(3)}`);
  console.log(`  avgRealizedTotalCost:  $${(baseline.totals?.avgRealizedTotalCostUSD ?? 0).toFixed(4)} → $${(experimental.totals?.avgRealizedTotalCostUSD ?? 0).toFixed(4)}`);

  const grBase = baseline.gateRejectionCounts?.byTaskType?.writing;
  const grExp = experimental.gateRejectionCounts?.byTaskType?.writing;
  if (grBase || grExp) {
    console.log("\nWriting gate rejection counts (baseline → experimental):");
    console.log(`  savingsPct:  ${grBase?.savingsPct ?? 0} → ${grExp?.savingsPct ?? 0}`);
    console.log(`  confidence:  ${grBase?.confidence ?? 0} → ${grExp?.confidence ?? 0}`);
    console.log(`  gap:         ${grBase?.gap ?? 0} → ${grExp?.gap ?? 0}`);
    console.log(`  noPromotion: ${grBase?.noPromotionTarget ?? 0} → ${grExp?.noPromotionTarget ?? 0}`);
    console.log(`  budget:      ${grBase?.budget ?? 0} → ${grExp?.budget ?? 0}`);
  }
  if (baseline.gateReasonCounts || experimental.gateReasonCounts) {
    console.log("\nGate reason counts:");

    const allReasons = new Set([...Object.keys(baseline.gateReasonCounts ?? {}), ...Object.keys(experimental.gateReasonCounts ?? {})]);
    for (const r of allReasons) {
      console.log(`  ${r}: ${baseline.gateReasonCounts?.[r] ?? 0} → ${experimental.gateReasonCounts?.[r] ?? 0}`);
    }
  }

  const wCfDelta = (wExp?.cheapFirstRate ?? 0) - (wBase?.cheapFirstRate ?? 0);
  const wEscDelta = (wExp?.escalationRate ?? 0) - (wBase?.escalationRate ?? 0);
  console.log("\nVerdict:");
  if (wCfDelta > 0 && wEscDelta <= 0 && (experimental.regret?.count ?? 0) === 0 && (experimental.economicRegret?.count ?? 0) === 0) {
    console.log("  ✓ Cheap-first rose, escalation stable/down, no regret. Loosen looks good.");
  } else if (wEscDelta > 0.1) {
    console.log("  ⚠ Escalations spiked. Consider dialing back to 0.11.");
  } else if ((experimental.regret?.count ?? 0) > 0 || (experimental.economicRegret?.count ?? 0) > 0) {
    console.log("  ⚠ Regret detected. Revert or tighten.");
  } else {
    console.log("  → Review metrics above.");
  }

  console.log("\nRestore backup: mv runs/runs_backup.jsonl runs/runs.jsonl");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
