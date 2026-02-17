// ─── app/api/observability/tuning/apply/route.ts ──────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getRunLedgerStore } from "../../../../../dist/src/lib/observability/runLedger.js";
import {
  summarizeLedger,
  aggregateKpis,
} from "../../../../../dist/src/lib/observability/analytics.js";
import { proposeTuning } from "../../../../../dist/src/lib/observability/tuning.js";
import { getPortfolioMode, setPortfolioMode } from "../../../../../dist/src/lib/governance/portfolioConfig.js";
import { isTuningEnabled } from "../../../../../dist/src/lib/observability/tuningConfig.js";
import { setForceRefreshNext } from "../../../../../dist/src/lib/governance/portfolioCache.js";

function err400(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 400 }
  );
}

function err404(code: string, message: string) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: 404 }
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!isTuningEnabled()) {
      return err400(
        "TUNING_DISABLED",
        "Tuning is disabled. Enable via tuningConfig.setTuningEnabled(true)."
      );
    }

    const raw = await request.json();
    const body = raw && typeof raw === "object" ? raw : {};
    const proposalId = body.proposalId ?? body.proposal_id;

    if (!proposalId || typeof proposalId !== "string") {
      return err400("VALIDATION_ERROR", "Missing or invalid proposalId");
    }

    const store = getRunLedgerStore();
    const items = store.listLedgers();
    const summaries = [];
    for (let i = 0; i < Math.min(50, items.length); i++) {
      const ledger = store.getLedger(items[i].runSessionId);
      if (ledger) summaries.push(summarizeLedger(ledger));
    }

    const kpis = aggregateKpis(summaries);
    const currentConfig = {
      portfolioMode: getPortfolioMode(),
      minPredictedQuality: 0.72,
    };

    const proposals = proposeTuning(kpis, summaries, currentConfig);
    const proposal = proposals.find((p) => p.id === proposalId);

    if (!proposal) {
      return err404("NOT_FOUND", `Proposal ${proposalId} not found or no longer applicable.`);
    }

    if (!proposal.safeToAutoApply) {
      return err400(
        "NOT_SAFE",
        `Proposal ${proposalId} is not safe to auto-apply. Action: ${proposal.action}`
      );
    }

    let applied = false;

    if (proposal.action === "set_portfolio_mode" && proposal.details.mode === "prefer") {
      setPortfolioMode("prefer");
      applied = true;
    } else if (proposal.action === "refresh_portfolio" && proposal.details.forceRefresh === true) {
      setForceRefreshNext();
      applied = true;
    }

    return NextResponse.json({
      success: true,
      applied,
      proposal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
