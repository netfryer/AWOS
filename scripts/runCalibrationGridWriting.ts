#!/usr/bin/env node
/**
 * Writing-only calibration grid: force gpt-4o-mini and gpt-4o on writing/high
 * to accumulate n ≈ 10–15 each. Then cheap-first can work once confidence rises.
 *
 * Requires dev server: npm run dev:ui
 * Usage: EVAL_SAMPLE_RATE_FORCE=1 npx tsx scripts/runCalibrationGridWriting.ts
 */

const BASE = process.env.CALIBRATION_BASE_URL ?? "http://localhost:3000";

const MODELS = ["gpt-4o-mini", "gpt-4o"];
const RUNS_PER_MODEL = parseInt(process.env.CALIBRATION_WRITING_RUNS ?? "15", 10);

const WRITING_TASK = {
  taskType: "writing" as const,
  difficulty: "high" as const,
  profile: "fast" as const,
  directive:
    "Write a 200-word professional launch announcement for an AI productivity platform, with a headline and 3 bullet features.",
};

async function forceRun(
  modelId: string,
  task: typeof WRITING_TASK
): Promise<{ ok: boolean; hadEval: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/force-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: task.directive,
        taskType: task.taskType,
        difficulty: task.difficulty,
        profile: task.profile,
        modelId,
      }),
    });
    const data = (await res.json()) as {
      final?: { status?: string };
      error?: string;
      attempts?: Array<{ eval?: { status?: string } }>;
    };
    if (!res.ok) {
      return { ok: false, hadEval: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    const lastAttempt = data?.attempts?.[(data.attempts?.length ?? 1) - 1];
    const hadEval = lastAttempt?.eval?.status === "ok";
    return {
      ok: data.final?.status === "ok",
      hadEval,
      error: data.error,
    };
  } catch (e) {
    return { ok: false, hadEval: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchCalibration(): Promise<{
  records: Array<{ modelId: string; taskType: string; n: number; ewmaQuality: number }>;
  computed: Array<{ modelId: string; taskType: string; calibratedExpertise: number; confidence: number }>;
}> {
  const res = await fetch(`${BASE}/api/stats/calibration`);
  if (!res.ok) throw new Error(`Failed to fetch calibration: ${res.status}`);
  return res.json();
}

async function main(): Promise<void> {
  console.log(`Writing-only calibration grid against ${BASE}`);
  console.log(`Models: ${MODELS.join(", ")}`);
  console.log(`Task: writing / high`);
  console.log(`${RUNS_PER_MODEL} runs per model (${MODELS.length * RUNS_PER_MODEL} total)\n`);

  let totalOk = 0;
  let totalEval = 0;

  for (const modelId of MODELS) {
    process.stdout.write(`${modelId}: `);
    for (let i = 0; i < RUNS_PER_MODEL; i++) {
      const r = await forceRun(modelId, WRITING_TASK);
      if (r.ok) totalOk++;
      if (r.hadEval) totalEval++;
      process.stdout.write(r.ok ? "." : "x");
    }
    console.log("");
  }

  console.log(`\nDone. ${totalOk}/${MODELS.length * RUNS_PER_MODEL} ok, ${totalEval} with eval.`);
  console.log("\n--- Writing calibration (gpt-4o-mini, gpt-4o) ---\n");

  const { records, computed } = await fetchCalibration();
  const writingRecords = records.filter((r) => r.taskType === "writing" && MODELS.includes(r.modelId));
  const computedMap = new Map(computed.map((c) => [`${c.modelId}|${c.taskType}`, c]));

  for (const r of writingRecords) {
    const c = computedMap.get(`${r.modelId}|${r.taskType}`);
    console.log(
      `${r.modelId}: n=${r.n}, ewmaQuality=${r.ewmaQuality.toFixed(4)}, confidence=${c ? c.confidence.toFixed(3) : "-"}`
    );
  }

  console.log("\nRe-run writing-only A/B with minConfidence=0.40 to test cheap-first.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
