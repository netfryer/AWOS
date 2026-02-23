/**
 * Run calibration tests: 10x Code (medium), 10x Writing (high), 10x Analysis (high).
 * Requires dev server: npm run dev:ui (or next dev) must be running.
 * Usage: npx tsx scripts/runCalibrationTests.ts
 */

const BASE = process.env.CALIBRATION_BASE_URL ?? "http://localhost:3000";

const TESTS = [
  {
    name: "Code (medium)",
    payload: {
      directive:
        "Write a JavaScript function that validates an email address with a regex and includes 3 example calls.",
      taskType: "code",
      difficulty: "medium",
      profile: "fast",
    },
    count: 10,
  },
  {
    name: "Writing (high)",
    payload: {
      directive:
        "Write a 200-word professional launch announcement for an AI productivity platform, with a headline and 3 bullet features.",
      taskType: "writing",
      difficulty: "high",
      profile: "strict",
    },
    count: 10,
  },
  {
    name: "Analysis (high)",
    payload: {
      directive:
        "Provide a structured 8-bullet risk analysis of deploying autonomous AI agents in enterprise IT, with mitigations.",
      taskType: "analysis",
      difficulty: "high",
      profile: "strict",
    },
    count: 10,
  },
];

async function runOne(
  payload: Record<string, unknown>
): Promise<{ ok: boolean; hadEval: boolean; final?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      final: data.final?.status,
      error: data.error,
    };
  } catch (e) {
    return { ok: false, hadEval: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log(`Running calibration tests against ${BASE}\n`);

  for (const { name, payload, count } of TESTS) {
    console.log(`--- ${name} (${count} runs) ---`);
    let ok = 0;
    let withEval = 0;
    for (let i = 0; i < count; i++) {
      const result = await runOne(payload);
      if (result.ok) ok++;
      if (result.hadEval) withEval++;
      process.stdout.write(result.ok ? "." : "x");
    }
    console.log(` ${ok}/${count} ok, ${withEval} with eval\n`);
  }

  console.log("Done. Check /api/stats/calibration for records.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
