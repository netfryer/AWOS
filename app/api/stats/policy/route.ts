import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { aggregatePolicyStats } from "../../../../src/policyStats";
import type { RunLogEvent } from "../../../../src/runLog";

const DEFAULT_RUNS_PATH = "./runs/runs.jsonl";

export async function GET() {
  try {
    const logPath = join(process.cwd(), DEFAULT_RUNS_PATH);
    let raw: string;
    try {
      raw = await readFile(logPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json(
          aggregatePolicyStats([]),
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      throw err;
    }

    const lines = raw.trim().split("\n").filter(Boolean);
    const events: RunLogEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RunLogEvent;
        events.push(parsed);
      } catch {
        // skip malformed lines
      }
    }

    const stats = aggregatePolicyStats(events);
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("API /api/stats/policy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
