// ─── src/app/api/projects/run-session/route.ts ──────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getRunSession } from "../../../../src/lib/execution/runSessionStore";

function err(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 400 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id?.trim()) {
      return err("VALIDATION_ERROR", "Missing required query param: id");
    }
    const session = getRunSession(id);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Run session not found" } },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, session });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
