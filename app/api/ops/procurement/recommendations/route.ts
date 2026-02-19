import { NextRequest, NextResponse } from "next/server";
import { getProcurementRecommendations } from "../../../../../src/lib/procurement/index";

/** GET: get procurement recommendations for tenant */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenant") ?? "default";
    const result = await getProcurementRecommendations(tenantId);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Unknown",
      },
      { status: 500 }
    );
  }
}
