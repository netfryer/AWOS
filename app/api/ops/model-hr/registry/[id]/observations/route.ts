// ─── app/api/ops/model-hr/registry/[id]/observations/route.ts ───────────────
//
// GET /api/ops/model-hr/registry/:id/observations?limit=50
// Returns recent observations for the model.
// Safe: returns [] when file missing.
//
// Example response:
// { "success": true, "observations": [
//   { "tsISO": "2025-02-14T12:00:00.000Z", "taskType": "code", "difficulty": "medium",
//     "actualCostUSD": 0.002, "predictedCostUSD": 0.0018, "actualQuality": 0.9, "predictedQuality": 0.85 }
// ]}

import { NextRequest, NextResponse } from "next/server";
import { loadObservationsForModel } from "../../../../../../../dist/src/lib/model-hr/index.js";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Model id is required" } },
        { status: 400 }
      );
    }
    const { searchParams } = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
    const observations = await loadObservationsForModel(id, limit);
    return NextResponse.json({ success: true, observations: observations ?? [] });
  } catch {
    return NextResponse.json({ success: true, observations: [] });
  }
}
