import { NextResponse } from "next/server";
import { getVarianceStatsTracker } from "../../../../src/varianceStats";

export async function GET() {
  try {
    const tracker = getVarianceStatsTracker();
    const stats = await tracker.getStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("API /api/stats/variance error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
