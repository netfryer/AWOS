// ─── app/api/projects/run-bundle/route.ts ───────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getRunLedgerStore } from "../../../../dist/src/lib/observability/runLedger.js";
import { summarizeLedger } from "../../../../dist/src/lib/observability/analytics.js";
import { getTrustTracker } from "../../../../dist/src/lib/governance/trustTracker.js";
import { getVarianceStatsTracker } from "../../../../dist/src/varianceStats.js";

function err(code: string, message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status }
  );
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl?.searchParams?.get("id");
    const includeTrust = request.nextUrl?.searchParams?.get("trust") !== "false";
    const includeVariance = request.nextUrl?.searchParams?.get("variance") !== "false";

    if (!id) {
      return err("VALIDATION_ERROR", "Missing required query parameter: id");
    }

    const store = getRunLedgerStore();
    const ledger = store.getLedger(id);

    if (!ledger) {
      return err("NOT_FOUND", `Ledger not found for runSessionId: ${id}`, 404);
    }

    const summary = summarizeLedger(ledger);

    const bundle: Record<string, unknown> = {
      ledger,
      summary,
    };

    if (includeTrust) {
      const trustTracker = getTrustTracker();
      const trust = trustTracker.getTrustMap();
      if (Object.keys(trust).length > 0) {
        bundle.trust = trust;
      }
    }

    if (includeVariance) {
      const varianceTracker = getVarianceStatsTracker();
      const stats = await varianceTracker.getStats();
      bundle.variance = stats;
    }

    return NextResponse.json(
      { success: true, bundle },
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="run-bundle-${id}.json"`,
        },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
