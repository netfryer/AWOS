import { NextRequest, NextResponse } from "next/server";
import { getProviderStatus } from "../../../../../src/lib/procurement/index";
import { listModels } from "../../../../../src/lib/model-hr/index";

/** GET: get provider status (enabled + credentials) for tenant */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenant") ?? "default";
    const models = await listModels({ includeDisabled: false });
    const providerIds = [...new Set(models.map((m) => m.identity.provider))];
    const status = await getProviderStatus(tenantId, providerIds.length > 0 ? providerIds : undefined);
    return NextResponse.json({ success: true, providers: status });
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
