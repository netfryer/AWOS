// ─── app/api/ops/model-hr/registry/[id]/priors/route.ts ─────────────────────
//
// GET /api/ops/model-hr/registry/:id/priors
// Returns performance priors for the model (by taskType+difficulty).
// Safe: returns [] when file missing.
//
// Example response:
// { "success": true, "priors": [
//   { "taskType": "code", "difficulty": "medium", "qualityPrior": 0.85,
//     "costMultiplier": 1.2, "sampleCount": 45, "lastUpdatedISO": "2025-02-14T12:00:00.000Z" }
// ]}

import { NextRequest, NextResponse } from "next/server";
import { loadPriorsForModel } from "../../../../../../../src/lib/model-hr/index";

export async function GET(
  _request: NextRequest,
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
    const priors = await loadPriorsForModel(id);
    return NextResponse.json({ success: true, priors: priors ?? [] });
  } catch {
    return NextResponse.json({ success: true, priors: [] });
  }
}
