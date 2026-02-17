// ─── app/api/observability/tuning/proposals/route.ts ──────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getRunLedgerStore } from "../../../../../dist/src/lib/observability/runLedger.js";
import {
  summarizeLedger,
  aggregateKpis,
} from "../../../../../dist/src/lib/observability/analytics.js";
import { proposeTuning } from "../../../../../dist/src/lib/observability/tuning.js";
import { getPortfolioMode } from "../../../../../dist/src/lib/governance/portfolioConfig.js";

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
      const ledger = store.getLedger(items[i].runSessionId);
      if (ledger) {
        summaries.push(summarizeLedger(ledger));
      }
    }

    const kpis = aggregateKpis(summaries);
    const currentConfig = {
      portfolioMode: getPortfolioMode(),
      minPredictedQuality: 0.72,
    };

    const proposals = proposeTuning(kpis, summaries, currentConfig);

    return NextResponse.json({ success: true, proposals });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
