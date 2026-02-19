// ─── app/api/observability/tuning/config/route.ts ─────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  isTuningEnabled,
  setTuningEnabled,
  isAllowAutoApply,
  setAllowAutoApply,
} from "../../../../../src/lib/observability/tuningConfig";

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      enabled: isTuningEnabled(),
      allowAutoApply: isAllowAutoApply(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { enabled, allowAutoApply: allowAuto } = body;

    if (typeof enabled === "boolean") {
      setTuningEnabled(enabled);
    }
    if (typeof allowAuto === "boolean") {
      setAllowAutoApply(allowAuto);
    }

    return NextResponse.json({
      success: true,
      enabled: isTuningEnabled(),
      allowAutoApply: isAllowAutoApply(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
