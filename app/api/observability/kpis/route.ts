// ─── app/api/observability/kpis/route.ts ──────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getRunLedgerStore } from "../../../../dist/src/lib/observability/runLedger.js";
import {
  summarizeLedger,
  aggregateKpis,
} from "../../../../dist/src/lib/observability/analytics.js";

function clampNum(val: unknown, min: number, max: number, def: number): number {
  if (val == null || val === "") return def;
  const n = Number(val);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function GET(request: NextRequest) {
  try {
    const window = clampNum(
      request.nextUrl?.searchParams?.get("window"),
      1,
      200,
      50
    );

    const store = getRunLedgerStore();
    const items = store.listLedgers();
    const summaries = [];

    for (let i = 0; i < Math.min(window, items.length); i++) {
      const item = items[i];
      const ledger = store.getLedger(item.runSessionId);
      if (ledger) {
        summaries.push(summarizeLedger(ledger));
      }
    }

    const kpis = aggregateKpis(summaries);

    return NextResponse.json({
      success: true,
      kpis,
      runs: summaries,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
