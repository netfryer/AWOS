import type { Request, Response } from "express";
import { getProviderStatus, getProcurementRecommendations, getTenantConfig, setTenantConfig } from "../../src/lib/procurement/index.js";
import { listModels } from "../../src/lib/model-hr/index.js";

function paramId(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : (v ?? "");
}

export async function statusGet(req: Request, res: Response) {
  try {
    const tenantId = (req.query.tenant as string) ?? "default";
    const models = await listModels({ includeDisabled: false });
    const providerIds = [...new Set(models.map((m) => m.identity.provider))];
    const status = await getProviderStatus(tenantId, providerIds.length > 0 ? providerIds : undefined);
    res.json({ success: true, providers: status });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : "Unknown",
    });
  }
}

export async function recommendationsGet(req: Request, res: Response) {
  try {
    const tenantId = (req.query.tenant as string) ?? "default";
    const result = await getProcurementRecommendations(tenantId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : "Unknown",
    });
  }
}

export async function tenantsGet(req: Request, res: Response) {
  try {
    const tenantId = paramId(req, "tenantId");
    const config = await getTenantConfig(tenantId);
    res.json({ success: true, config: config ?? null });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

export async function tenantsPut(req: Request, res: Response) {
  try {
    const tenantId = paramId(req, "tenantId");
    const raw = req.body;
    if (raw == null || typeof raw !== "object") {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Request body must be a JSON object" } });
    }
    if (raw.tenantId !== tenantId) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId in body must match URL" } });
    }
    const config = {
      tenantId: raw.tenantId as string,
      providerSubscriptions: (raw.providerSubscriptions ?? []) as Array<{ providerId: string; enabled: boolean }>,
      modelAvailability: (raw.modelAvailability ?? {}) as {
        allowedProviders?: string[];
        blockedProviders?: string[];
        allowedModelIds?: string[];
        blockedModelIds?: string[];
        allowedTiers?: ("cheap" | "standard" | "premium")[];
        defaultProviderPreference?: string;
      },
      ignoredRecommendationModelIds: Array.isArray(raw.ignoredRecommendationModelIds) ? raw.ignoredRecommendationModelIds as string[] : undefined,
    };
    await setTenantConfig(config);
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}
