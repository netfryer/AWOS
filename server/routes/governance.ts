/**
 * Governance API routes - portfolio, portfolio-config.
 */

import type { Request, Response } from "express";
import {
  getPortfolioMode,
  setPortfolioMode,
  type PortfolioConfigMode,
} from "../../src/lib/governance/portfolioConfig.js";
import { recommendPortfolio } from "../../src/lib/governance/portfolioOptimizer.js";
import { getTrustTracker } from "../../src/lib/governance/trustTracker.js";
import { getVarianceStatsTracker } from "../../src/varianceStats.js";
import { getModelRegistryForRuntime } from "../../src/lib/model-hr/index.js";

const VALID_MODES: PortfolioConfigMode[] = ["off", "prefer", "lock"];

function clampNum(val: unknown, min: number, max: number, def: number): number {
  if (val == null || val === "") return def;
  const n = Number(val);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function err(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ success: false, error: { code, message, details } });
}

export async function portfolioConfigGet(_req: Request, res: Response) {
  try {
    const mode = getPortfolioMode();
    res.json({ success: true, mode });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function portfolioConfigPost(req: Request, res: Response) {
  try {
    const body = req.body ?? {};
    const modeRaw = body.mode;
    const mode = typeof modeRaw === "string" ? modeRaw.toLowerCase().trim() : "";
    if (!VALID_MODES.includes(mode as PortfolioConfigMode)) {
      return err(
        res,
        400,
        "VALIDATION_ERROR",
        `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}`,
        { received: modeRaw }
      );
    }
    setPortfolioMode(mode as PortfolioConfigMode);
    res.json({ success: true, mode: mode as PortfolioConfigMode });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function clarifyPost(req: Request, res: Response) {
  try {
    const body = req.body as { directive?: string };
    if (!body.directive?.trim()) {
      return res.status(400).json({ error: "Missing required field: directive" });
    }
    const { runExecutiveCouncil } = await import("../../src/governance/executiveCouncil.js");
    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const result = await runExecutiveCouncil(
      { directive: body.directive },
      modelRegistry,
      "./runs/governance.jsonl"
    );
    res.json({ run: result.run, brief: result.brief, gate: result.gate });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}

export async function trustGet(_req: Request, res: Response) {
  try {
    const tracker = getTrustTracker();
    const trustMap = tracker.getTrustMap();
    const trustByRole = tracker.getTrustRoleMap();
    const trustLastUpdated: Record<string, string> = {};
    for (const [modelId, v] of Object.entries(trustByRole)) {
      if (v.lastUpdatedISO) trustLastUpdated[modelId] = v.lastUpdatedISO;
    }
    res.json({ success: true, trust: trustMap, trustByRole, trustLastUpdated });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function varianceGet(_req: Request, res: Response) {
  try {
    const { getVarianceStatsTracker } = await import("../../src/varianceStats.js");
    const varianceTracker = getVarianceStatsTracker();
    const stats = await varianceTracker.getStats();
    const trustTracker = getTrustTracker();
    const trust = trustTracker.getTrustMap();
    res.json({ success: true, variance: stats, trust: Object.keys(trust).length > 0 ? trust : undefined });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}

export async function portfolioGet(req: Request, res: Response) {
  try {
    const trustFloorWorker = clampNum(req.query.trustFloorWorker, 0, 1, 0.5);
    const trustFloorQa = clampNum(req.query.trustFloorQa, 0, 1, 0.55);
    const minPredictedQuality = clampNum(req.query.minPredictedQuality, 0, 1, 0.72);
    const trustTracker = getTrustTracker();
    const varianceStatsTracker = getVarianceStatsTracker();
    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const recommendation = await recommendPortfolio({
      modelRegistry,
      trustTracker,
      varianceStatsTracker,
      trustFloors: { worker: trustFloorWorker, qa: trustFloorQa },
      minPredictedQuality,
    });
    res.json({ success: true, recommendation });
  } catch (e) {
    err(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : "Internal server error");
  }
}
