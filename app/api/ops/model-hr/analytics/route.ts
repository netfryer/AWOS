// ─── app/api/ops/model-hr/analytics/route.ts ─────────────────────────────────
// GET /api/ops/model-hr/analytics?windowHours=24

import { NextRequest, NextResponse } from "next/server";
import { buildModelHrAnalytics } from "../../../../../src/lib/model-hr/analytics/index";
import { getRunLedgerStore } from "../../../../../src/lib/observability/runLedger";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const windowHours = Math.min(
      Math.max(1, parseInt(searchParams.get("windowHours") ?? "24", 10) || 24),
      720
    );

    const ledgerStore = getRunLedgerStore();
    const analytics = await buildModelHrAnalytics(windowHours, ledgerStore);
    return NextResponse.json(analytics);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
