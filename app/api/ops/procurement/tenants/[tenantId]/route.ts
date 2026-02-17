import { NextRequest, NextResponse } from "next/server";
import {
  getTenantConfig,
  setTenantConfig,
} from "../../../../../../dist/src/lib/procurement/index.js";

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

/** GET: get tenant procurement config */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const config = await getTenantConfig(tenantId);
    if (!config) {
      return NextResponse.json({
        success: true,
        config: null,
      });
    }
    return NextResponse.json({ success: true, config });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}

const ProviderSubscriptionSchema = {
  providerId: (v: unknown) => typeof v === "string" && v.length > 0,
  enabled: (v: unknown) => typeof v === "boolean",
};

const TenantConfigBodySchema = {
  tenantId: (v: unknown) => typeof v === "string" && v.length > 0,
  providerSubscriptions: (v: unknown) =>
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        typeof x === "object" &&
        ProviderSubscriptionSchema.providerId((x as { providerId?: unknown }).providerId) &&
        ProviderSubscriptionSchema.enabled((x as { enabled?: unknown }).enabled)
    ),
  modelAvailability: (v: unknown) =>
    v == null ||
    (typeof v === "object" &&
      (Array.isArray((v as { allowedProviders?: unknown }).allowedProviders) ||
        (v as { allowedProviders?: unknown }).allowedProviders === undefined) &&
      (Array.isArray((v as { blockedProviders?: unknown }).blockedProviders) ||
        (v as { blockedProviders?: unknown }).blockedProviders === undefined) &&
      (Array.isArray((v as { allowedModelIds?: unknown }).allowedModelIds) ||
        (v as { allowedModelIds?: unknown }).allowedModelIds === undefined) &&
      (Array.isArray((v as { blockedModelIds?: unknown }).blockedModelIds) ||
        (v as { blockedModelIds?: unknown }).blockedModelIds === undefined)),
};

/** PUT: set tenant procurement config (non-secret only) */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const raw = await request.json();
    if (raw == null || typeof raw !== "object") {
      return err400("VALIDATION_ERROR", "Request body must be a JSON object");
    }
    if (raw.tenantId !== tenantId) {
      return err400("VALIDATION_ERROR", "tenantId in body must match URL");
    }
    if (
      !TenantConfigBodySchema.tenantId(raw.tenantId) ||
      !TenantConfigBodySchema.providerSubscriptions(raw.providerSubscriptions) ||
      !TenantConfigBodySchema.modelAvailability(raw.modelAvailability)
    ) {
      return err400("VALIDATION_ERROR", "Invalid config structure");
    }
    const config = {
      tenantId: raw.tenantId as string,
      providerSubscriptions: raw.providerSubscriptions as Array<{
        providerId: string;
        enabled: boolean;
      }>,
      modelAvailability: (raw.modelAvailability ?? {}) as {
        allowedProviders?: string[];
        blockedProviders?: string[];
        allowedModelIds?: string[];
        blockedModelIds?: string[];
        allowedTiers?: ("cheap" | "standard" | "premium")[];
        defaultProviderPreference?: string;
      },
      ignoredRecommendationModelIds: Array.isArray(raw.ignoredRecommendationModelIds)
        ? (raw.ignoredRecommendationModelIds as string[])
        : undefined,
    };
    await setTenantConfig(config);
    return NextResponse.json({ success: true, config });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
