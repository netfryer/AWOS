/**
 * Fill calibration matrix via force-run: each model × each task type, 3 runs per pair.
 * Requires dev server: npm run dev:ui (or next dev) must be running.
 * Usage: npx tsx scripts/runCalibrationGrid.ts [--include-haiku]
 */

const BASE = process.env.CALIBRATION_BASE_URL ?? "http://localhost:3000";

const MODELS = ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4-5-20250929"];
const HAIKU = "claude-haiku-4-5-20251001";

const TASKS: {
  taskType: "code" | "writing" | "analysis";
  difficulty: "medium" | "high";
  profile: "fast" | "strict";
  directive: string;
}[] = [
  {
    taskType: "code",
    difficulty: "medium",
    profile: "fast",
    directive:
      "Write a JavaScript function that validates an email address with a regex and includes 3 example calls.",
  },
  {
    taskType: "writing",
    difficulty: "high",
    profile: "strict",
    directive:
      "Write a 200-word professional launch announcement for an AI productivity platform, with a headline and 3 bullet features.",
  },
  {
    taskType: "analysis",
    difficulty: "high",
    profile: "strict",
    directive:
      "Provide a structured 8-bullet risk analysis of deploying autonomous AI agents in enterprise IT, with mitigations.",
  },
];

const RUNS_PER_PAIR = 3;

async function forceRun(
  modelId: string,
  task: (typeof TASKS)[0]
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

async function fetchCalibration(): Promise<
  { records: Array<{ modelId: string; taskType: string; n: number; ewmaQuality: number }>; computed: Array<{ modelId: string; taskType: string; calibratedExpertise: number; confidence: number }> }
> {
  const res = await fetch(`${BASE}/api/stats/calibration`);
  if (!res.ok) throw new Error(`Failed to fetch calibration: ${res.status}`);
  return res.json();
}

function main() {
  const includeHaiku = process.argv.includes("--include-haiku");
  const models = includeHaiku ? [...MODELS, HAIKU] : MODELS;

  console.log(`Running calibration grid against ${BASE}`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Tasks: ${TASKS.map((t) => `${t.taskType}(${t.difficulty})`).join(", ")}`);
  console.log(`${RUNS_PER_PAIR} runs per (model, taskType) pair\n`);

  (async () => {
    let totalOk = 0;
    let totalEval = 0;
    for (const modelId of models) {
      for (const task of TASKS) {
        process.stdout.write(`  ${modelId} / ${task.taskType}: `);
        for (let i = 0; i < RUNS_PER_PAIR; i++) {
          const r = await forceRun(modelId, task);
          if (r.ok) totalOk++;
          if (r.hadEval) totalEval++;
          process.stdout.write(r.ok ? "." : "x");
        }
        console.log("");
      }
    }

    console.log(`\nDone. ${totalOk}/${models.length * TASKS.length * RUNS_PER_PAIR} ok, ${totalEval} with eval.`);
    console.log("\n--- Calibration summary ---\n");

    const { records, computed } = await fetchCalibration();
    const byKey = (r: { modelId: string; taskType: string }) => `${r.modelId}|${r.taskType}`;
    const computedMap = new Map(computed.map((c) => [byKey(c), c]));

    const rows = records.map((r) => {
      const c = computedMap.get(byKey(r));
      return {
        modelId: r.modelId,
        taskType: r.taskType,
        n: r.n,
        ewmaQuality: r.ewmaQuality.toFixed(4),
        calibratedExpertise: c ? c.calibratedExpertise.toFixed(4) : "-",
        confidence: c ? c.confidence.toFixed(3) : "-",
      };
    });

    const w = { modelId: 28, taskType: 10, n: 4, ewma: 10, cal: 10, conf: 8 };
    const pad = (s: string, len: number) => String(s).padEnd(len).slice(0, len);
    console.log(
      pad("modelId", w.modelId) +
        pad("taskType", w.taskType) +
        pad("n", w.n) +
        pad("ewmaQuality", w.ewma) +
        pad("calExpertise", w.cal) +
        pad("confidence", w.conf)
    );
    console.log("-".repeat(w.modelId + w.taskType + w.n + w.ewma + w.cal + w.conf));
    for (const row of rows) {
      console.log(
        pad(row.modelId, w.modelId) +
          pad(row.taskType, w.taskType) +
          pad(String(row.n), w.n) +
          pad(row.ewmaQuality, w.ewma) +
          pad(row.calibratedExpertise, w.cal) +
          pad(row.confidence, w.conf)
      );
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
