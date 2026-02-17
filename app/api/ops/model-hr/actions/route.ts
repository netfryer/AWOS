// ─── app/api/ops/model-hr/actions/route.ts ─────────────────────────────────
// GET /api/ops/model-hr/actions?limit=

import { NextRequest, NextResponse } from "next/server";
import { listActions } from "../../../../../dist/src/lib/model-hr/index.js";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 500);
    const actions = await listActions(limit);
    return NextResponse.json({ success: true, actions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
