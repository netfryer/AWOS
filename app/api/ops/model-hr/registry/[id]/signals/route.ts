// ─── app/api/ops/model-hr/registry/[id]/signals/route.ts ─────────────────────
//
// GET /api/ops/model-hr/registry/:id/signals?limit=50
// Returns recent signals for this model (filtered from signals.jsonl).
// Safe: returns [] when file missing or on error.
//
// Example response:
// { "success": true, "signals": [
//   { "modelId": "openai/gpt-4o", "tsISO": "2025-02-14T12:00:00.000Z",
//     "previousStatus": "active", "newStatus": "probation", "reason": "cost_variance", "sampleCount": 50 }
// ]}

import { NextRequest, NextResponse } from "next/server";
import { readModelHrSignalsForModel } from "../../../../../../../dist/src/lib/model-hr/index.js";

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
    const signals = await readModelHrSignalsForModel(id, limit);
    return NextResponse.json({ success: true, signals: signals ?? [] });
  } catch {
    return NextResponse.json({ success: true, signals: [] });
  }
}
