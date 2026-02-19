// ─── src/app/api/governance/trust/route.ts ──────────────────────────────────

import { NextResponse } from "next/server";
import { getTrustTracker } from "../../../../src/lib/governance/trustTracker";

function err500(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 500 }
  );
}

export async function GET() {
  try {
    const tracker = getTrustTracker();
    const trustMap = tracker.getTrustMap();
    const trustByRole = tracker.getTrustRoleMap();
    const trustLastUpdated: Record<string, string> = {};
    for (const [modelId, v] of Object.entries(trustByRole)) {
      if (v.lastUpdatedISO) trustLastUpdated[modelId] = v.lastUpdatedISO;
    }
    return NextResponse.json({ success: true, trust: trustMap, trustByRole, trustLastUpdated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
