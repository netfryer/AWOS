import { NextResponse } from "next/server";
import { getRegistryFallbackCountLastHours } from "../../../../../dist/src/lib/model-hr/index.js";

export async function GET() {
  try {
    const fallbackCount24h = await getRegistryFallbackCountLastHours(24);
    return NextResponse.json({
      registryHealth: fallbackCount24h > 0 ? "FALLBACK" : "OK",
      fallbackCount24h,
    });
  } catch (e) {
    return NextResponse.json(
      { registryHealth: "UNKNOWN", fallbackCount24h: 0, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}
