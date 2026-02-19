// ─── src/app/api/projects/ledger/route.ts ───────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getRunLedgerStore } from "../../../../src/lib/observability/runLedger";

function err(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 400 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl?.searchParams?.get("id");
    if (!id) {
      return err("VALIDATION_ERROR", "Missing required query parameter: id");
    }

    const store = getRunLedgerStore();
    const ledger = store.getLedger(id);

    if (!ledger) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: `Ledger not found for runSessionId: ${id}` } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, ledger });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
