import { NextResponse } from "next/server";
import { getModelStatsTracker } from "../../../src/modelStats";

export async function GET() {
  try {
    const tracker = getModelStatsTracker();
    const stats = await tracker.getStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("API /api/stats error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
