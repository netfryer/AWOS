// ─── app/api/ops/model-hr/signals/route.ts ─────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { readModelHrSignals } from "../../../../../dist/src/lib/model-hr/index.js";

function err500(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 500 }
  );
}

/** GET: list recent Model HR signals (probation, auto-disable, kill-switch) */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));
    const signals = await readModelHrSignals(limit);
    return NextResponse.json({ success: true, signals });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
