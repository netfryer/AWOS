/**
 * Heuristics for procurement recommendations.
 * Uses recruiting report, cycle summary, registry, analytics.
 */

import type { ModelRegistryEntry } from "../../model-hr/types.js";

export interface RecruitingReportData {
  tsISO?: string;
  created?: Array<{ modelId?: string; canonicalId?: string }>;
  updated?: Array<{ modelId?: string; canonicalId?: string }>;
  skipped?: Array<{ modelId?: string; canonicalId?: string }>;
}

export interface CycleRow {
  modelId: string;
  statusBefore: string;
  statusAfter: string;
  canaryAvgQuality: number;
  failedCount: number;
  action: string;
}

export interface CycleSummaryData {
  tsISO?: string;
  canaryCount?: number;
  rows?: CycleRow[];
}

export interface ProcurementRecommendation {
  modelId: string;
  canonicalId: string;
  provider: string;
  reason: string;
  evidence?: Record<string, unknown>;
}

/** New models from recruiting (created). */
export function recommendNewFromRecruiting(
  report: RecruitingReportData | null,
  tenantAllowedIds: Set<string>,
  registryById: Map<string, ModelRegistryEntry>
): ProcurementRecommendation[] {
  const out: ProcurementRecommendation[] = [];
  const created = report?.created ?? [];
  for (const item of created) {
    const cid = item.canonicalId ?? item.modelId;
    if (!cid) continue;
    const lower = cid.toLowerCase();
    if (tenantAllowedIds.has(lower)) continue;
    const entry = registryById.get(cid) ?? registryById.get(lower);
    if (entry) {
      out.push({
        modelId: entry.identity.modelId,
        canonicalId: entry.id,
        provider: entry.identity.provider,
        reason: "new_model_from_recruiting",
        evidence: { source: "recruiting-report", action: "created" },
      });
    }
  }
  return out;
}

/** Models that graduated from canary (promoted to active). */
export function recommendFromCanaryGraduates(
  cycle: CycleSummaryData | null,
  tenantAllowedIds: Set<string>,
  registryById: Map<string, ModelRegistryEntry>
): ProcurementRecommendation[] {
  const out: ProcurementRecommendation[] = [];
  const rows = cycle?.rows ?? [];
  for (const r of rows) {
    if (r.action !== "promoted" && r.action !== "promote_recommended" && r.action !== "promote_pending") continue;
    const cid = r.modelId;
    if (!cid) continue;
    const lower = cid.toLowerCase();
    if (tenantAllowedIds.has(lower)) continue;
    const entry = registryById.get(cid) ?? registryById.get(lower);
    if (entry) {
      out.push({
        modelId: entry.identity.modelId,
        canonicalId: entry.id,
        provider: entry.identity.provider,
        reason: "canary_graduate",
        evidence: {
          canaryAvgQuality: r.canaryAvgQuality,
          failedCount: r.failedCount,
          statusAfter: r.statusAfter,
        },
      });
    }
  }
  return out;
}

/** Recommend enabling provider if tenant has disabled it but registry has models. */
export function recommendEnableProvider(
  providerIds: string[],
  providerSubscriptions: Array<{ providerId: string; enabled: boolean }>,
  registryByProvider: Map<string, ModelRegistryEntry[]>
): Array<{ providerId: string; reason: string }> {
  const out: Array<{ providerId: string; reason: string }> = [];
  const enabledByProvider = new Map(
    providerSubscriptions.map((s) => [s.providerId.toLowerCase(), s.enabled])
  );
  for (const pid of providerIds) {
    const pl = pid.toLowerCase();
    const enabled = enabledByProvider.get(pl);
    if (enabled !== false) continue;
    const models = registryByProvider.get(pid) ?? registryByProvider.get(pl) ?? [];
    if (models.length === 0) continue;
    const hasActive = models.some((m) => m.identity.status === "active" || m.identity.status === "probation");
    if (!hasActive) continue;
    out.push({
      providerId: pid,
      reason: "provider_has_models_not_enabled",
    });
  }
  return out;
}
