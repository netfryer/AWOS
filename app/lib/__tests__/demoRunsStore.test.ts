// ─── app/lib/__tests__/demoRunsStore.test.ts ─────────────────────────────────
import { describe, it, expect } from "vitest";
import { extractDeliverablesFromRuns } from "../demoRunsStore";

describe("extractDeliverablesFromRuns", () => {
  it("extracts aggregation-report output", () => {
    const runs = [
      { packageId: "worker-1", output: "worker output", artifactId: "a1" },
      { packageId: "aggregation-report", output: "# Final report\n\n```\nsummary\n```", artifactId: "a2" },
    ];
    const out = extractDeliverablesFromRuns(runs);
    expect(out["aggregation-report"]?.output).toBe("# Final report\n\n```\nsummary\n```");
    expect(out["aggregation-report"]?.artifactId).toBe("a2");
    expect(out["worker-1"]?.output).toBe("worker output");
  });

  it("returns empty object for empty or invalid input", () => {
    expect(extractDeliverablesFromRuns(undefined)).toEqual({});
    expect(extractDeliverablesFromRuns([])).toEqual({});
    expect(extractDeliverablesFromRuns([{ packageId: "", output: "x" }])).toEqual({});
  });

  it("skips runs without output or artifactId", () => {
    const runs = [
      { packageId: "agg", output: "", artifactId: undefined },
      { packageId: "agg2", output: "has output", artifactId: "x" },
    ];
    const out = extractDeliverablesFromRuns(runs);
    expect(out["agg"]).toBeUndefined();
    expect(out["agg2"]?.output).toBe("has output");
  });
});
