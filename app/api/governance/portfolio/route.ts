// ─── app/api/governance/portfolio/route.ts ───────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { recommendPortfolio } from "../../../../src/lib/governance/portfolioOptimizer";
import { getTrustTracker } from "../../../../src/lib/governance/trustTracker";
import { getVarianceStatsTracker } from "../../../../src/varianceStats";
import { getModelRegistryForRuntime } from "../../../../src/lib/model-hr/index";

function clampNum(val: unknown, min: number, max: number, def: number): number {
  if (val == null || val === "") return def;
  const n = Number(val);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function err400(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 400 }
  );
}

function err500(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const trustFloorWorker = clampNum(
      searchParams.get("trustFloorWorker"),
      0,
      1,
      0.5
    );
    const trustFloorQa = clampNum(searchParams.get("trustFloorQa"), 0, 1, 0.55);
    const minPredictedQuality = clampNum(
      searchParams.get("minPredictedQuality"),
      0,
      1,
      0.72
    );

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

    return NextResponse.json({
      success: true,
      recommendation,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
