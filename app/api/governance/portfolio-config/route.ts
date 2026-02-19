// ─── app/api/governance/portfolio-config/route.ts ────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  getPortfolioMode,
  setPortfolioMode,
  type PortfolioConfigMode,
} from "../../../../src/lib/governance/portfolioConfig";

const VALID_MODES: PortfolioConfigMode[] = ["off", "prefer", "lock"];

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

export async function GET() {
  try {
    const mode = getPortfolioMode();
    return NextResponse.json({ success: true, mode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const body = raw && typeof raw === "object" ? raw : {};
    const modeRaw = body.mode;
    const mode = typeof modeRaw === "string" ? modeRaw.toLowerCase().trim() : "";

    if (!VALID_MODES.includes(mode as PortfolioConfigMode)) {
      return err400(
        "VALIDATION_ERROR",
        `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}`,
        { received: modeRaw }
      );
    }

    setPortfolioMode(mode as PortfolioConfigMode);
    return NextResponse.json({ success: true, mode: mode as PortfolioConfigMode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
