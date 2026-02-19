// ─── src/app/api/governance/variance/route.ts ───────────────────────────────

import { NextResponse } from "next/server";
import { getVarianceStatsTracker } from "../../../../src/varianceStats";
import { getTrustTracker } from "../../../../src/lib/governance/trustTracker";

function err500(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 500 }
  );
}

export async function GET() {
  try {
    const varianceTracker = getVarianceStatsTracker();
    const stats = await varianceTracker.getStats();

    const trustTracker = getTrustTracker();
    const trust = trustTracker.getTrustMap();

    return NextResponse.json({
      success: true,
      variance: stats,
      trust: Object.keys(trust).length > 0 ? trust : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
