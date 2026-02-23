/**
 * Smoke tests for /api/run with lowest_cost_qualified vs best_value.
 * Run with: npx tsx scripts/smokeRunApi.ts
 * Requires dev server: npm run dev:ui (in another terminal)
 */

const BASE = "http://localhost:3000";

async function smokeRun(payload: Record<string, unknown>): Promise<{ rationale?: string; chosenModelId?: string; error?: string }> {
  const res = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { routing?: { rationale?: string; chosenModelId?: string }; error?: string };
  if (!res.ok) return { error: data?.error ?? `HTTP ${res.status}` };
  return { rationale: data.routing?.rationale, chosenModelId: data.routing?.chosenModelId };
}

async function main() {
  const payload = {
    message: "Implement a simple CSV parser",
    taskType: "code",
    difficulty: "medium",
    profile: "fast",
  };

  console.log("--- Smoke test 1: lowest_cost_qualified ---");
  const r1 = await smokeRun({ ...payload, selectionPolicyOverride: "lowest_cost_qualified" });
  if (r1.error) console.log("Error:", r1.error);
  else console.log("Rationale:", r1.rationale);
  console.log("Chosen:", r1.chosenModelId);
  console.log();

  console.log("--- Smoke test 2: best_value (code/medium/fast) ---");
  const r2 = await smokeRun({ ...payload, selectionPolicyOverride: "best_value" });
  if (r2.error) console.log("Error:", r2.error);
  else console.log("Rationale:", r2.rationale);
  console.log("Chosen:", r2.chosenModelId);
  console.log();

  console.log("--- Smoke test 3: best_value (code/high/strict, may hit near-threshold) ---");
  const r3 = await smokeRun({
    ...payload,
    taskType: "code",
    difficulty: "high",
    profile: "strict",
    selectionPolicyOverride: "best_value",
  });
  if (r3.error) console.log("Error:", r3.error);
  else console.log("Rationale:", r3.rationale);
  console.log("Chosen:", r3.chosenModelId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
