import type { Request, Response } from "express";
import { getLedgerAsync, listLedgersAsync } from "../../src/lib/observability/runLedger.js";
import { summarizeLedger, aggregateKpis } from "../../src/lib/observability/analytics.js";
import { proposeTuning } from "../../src/lib/observability/tuning.js";
import { getPortfolioMode } from "../../src/lib/governance/portfolioConfig.js";
import {
  isTuningEnabled,
  setTuningEnabled,
  isAllowAutoApply,
  setAllowAutoApply,
} from "../../src/lib/observability/tuningConfig.js";
import { setPortfolioMode } from "../../src/lib/governance/portfolioConfig.js";
import { setForceRefreshNext } from "../../src/lib/governance/portfolioCache.js";

function clampNum(val: unknown, min: number, max: number, def: number): number {
  if (val == null || val === "") return def;
  const n = Number(val);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function kpisGet(req: Request, res: Response) {
  try {
    const window = clampNum(req.query.window, 1, 200, 50);
    const items = await listLedgersAsync();
    const summaries = [];
    for (let i = 0; i < Math.min(window, items.length); i++) {
      const ledger = await getLedgerAsync(items[i].runSessionId);
      if (ledger) summaries.push(summarizeLedger(ledger));
    }
    const kpis = aggregateKpis(summaries);
    res.json({ success: true, kpis, runs: summaries });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function tuningProposalsGet(req: Request, res: Response) {
  try {
    const window = clampNum(req.query.window, 1, 200, 50);
    const items = await listLedgersAsync();
    const summaries = [];
    for (let i = 0; i < Math.min(window, items.length); i++) {
      const ledger = await getLedgerAsync(items[i].runSessionId);
      if (ledger) summaries.push(summarizeLedger(ledger));
    }
    const kpis = aggregateKpis(summaries);
    const currentConfig = { portfolioMode: getPortfolioMode(), minPredictedQuality: 0.72 };
    const proposals = proposeTuning(kpis, summaries, currentConfig);
    res.json({ success: true, proposals });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function tuningConfigGet(_req: Request, res: Response) {
  try {
    res.json({ success: true, enabled: isTuningEnabled(), allowAutoApply: isAllowAutoApply() });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function tuningConfigPost(req: Request, res: Response) {
  try {
    const body = req.body ?? {};
    if (typeof body.enabled === "boolean") setTuningEnabled(body.enabled);
    if (typeof body.allowAutoApply === "boolean") setAllowAutoApply(body.allowAutoApply);
    res.json({ success: true, enabled: isTuningEnabled(), allowAutoApply: isAllowAutoApply() });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function tuningApplyPost(req: Request, res: Response) {
  try {
    if (!isTuningEnabled()) {
      return res.status(400).json({
        success: false,
        error: { code: "TUNING_DISABLED", message: "Tuning is disabled." },
      });
    }
    const body = req.body ?? {};
    const proposalId = body.proposalId ?? body.proposal_id;
    if (!proposalId || typeof proposalId !== "string") {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Missing or invalid proposalId" } });
    }
    const items = await listLedgersAsync();
    const summaries = [];
    for (let i = 0; i < Math.min(50, items.length); i++) {
      const ledger = await getLedgerAsync(items[i].runSessionId);
      if (ledger) summaries.push(summarizeLedger(ledger));
    }
    const kpis = aggregateKpis(summaries);
    const currentConfig = { portfolioMode: getPortfolioMode(), minPredictedQuality: 0.72 };
    const proposals = proposeTuning(kpis, summaries, currentConfig);
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Proposal ${proposalId} not found` } });
    }
    if (!proposal.safeToAutoApply) {
      return res.status(400).json({ success: false, error: { code: "NOT_SAFE", message: `Proposal ${proposalId} is not safe to auto-apply` } });
    }
    let applied = false;
    if (proposal.action === "set_portfolio_mode" && proposal.details?.mode === "prefer") {
      setPortfolioMode("prefer");
      applied = true;
    } else if (proposal.action === "refresh_portfolio" && proposal.details?.forceRefresh === true) {
      setForceRefreshNext();
      applied = true;
    }
    res.json({ success: true, applied, proposal });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}
