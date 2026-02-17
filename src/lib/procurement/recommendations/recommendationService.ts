/**
 * RecommendationService: suggest models to acquire based on Model HR signals.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { listModels } from "../../model-hr/index.js";
import type { ModelRegistryEntry } from "../../model-hr/types.js";
import { getTenantConfig } from "../procurementService.js";
import {
  recommendNewFromRecruiting,
  recommendFromCanaryGraduates,
  recommendEnableProvider,
  type RecruitingReportData,
  type CycleSummaryData,
  type ProcurementRecommendation,
} from "./heuristics.js";

const DEFAULT_TENANT = "default";

function getModelHrDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

export interface ProcurementRecommendationResult {
  tenantId: string;
  providerRecommendations: Array<{ providerId: string; reason: string }>;
  modelRecommendations: ProcurementRecommendation[];
}

export async function getProcurementRecommendations(
  tenantId: string = DEFAULT_TENANT
): Promise<ProcurementRecommendationResult> {
  const config = await getTenantConfig(tenantId);
  const ignored = new Set(
    (config?.modelAvailability?.allowedModelIds ?? [])
      .concat(config?.ignoredRecommendationModelIds ?? [])
      .map((id) => id.toLowerCase())
  );
  const tenantAllowedIds = new Set(
    (config?.modelAvailability?.allowedModelIds ?? []).map((id) => id.toLowerCase())
  );
  const allowedModelIds = config?.modelAvailability?.allowedModelIds;
  const hasAllowlist = allowedModelIds != null && allowedModelIds.length > 0;
  const tenantAllowedForFilter = hasAllowlist ? tenantAllowedIds : new Set<string>();

  let recruitingReport: RecruitingReportData | null = null;
  let cycleSummary: CycleSummaryData | null = null;

  try {
    const dataDir = getModelHrDataDir();
    const reportRaw = await readFile(join(dataDir, "recruiting-report.json"), "utf-8");
    recruitingReport = JSON.parse(reportRaw) as RecruitingReportData;
  } catch {
    /* missing */
  }

  try {
    const dataDir = getModelHrDataDir();
    const cycleRaw = await readFile(join(dataDir, "cycle-summary.json"), "utf-8");
    cycleSummary = JSON.parse(cycleRaw) as CycleSummaryData;
  } catch {
    /* missing */
  }

  const registryEntries = await listModels({ includeDisabled: false });
  const registryById = new Map(registryEntries.map((e) => [e.id, e]));
  const registryByLower = new Map(registryEntries.map((e) => [e.id.toLowerCase(), e]));
  const combinedById = new Map<string, ModelRegistryEntry>([
    ...registryById,
    ...registryByLower,
  ]);
  const registryByProvider = new Map<string, ModelRegistryEntry[]>();
  for (const e of registryEntries) {
    const p = e.identity.provider;
    const list = registryByProvider.get(p) ?? [];
    list.push(e);
    registryByProvider.set(p, list);
  }

  const providerIds = [...registryByProvider.keys()];
  const providerRecs = recommendEnableProvider(
    providerIds,
    config?.providerSubscriptions ?? [],
    registryByProvider
  );

  const newFromRecruiting = recommendNewFromRecruiting(
    recruitingReport,
    tenantAllowedForFilter,
    combinedById
  );
  const fromCanary = recommendFromCanaryGraduates(
    cycleSummary,
    tenantAllowedForFilter,
    combinedById
  );

  const allModelRecs = [...newFromRecruiting, ...fromCanary];
  const deduped = new Map<string, ProcurementRecommendation>();
  for (const r of allModelRecs) {
    const key = r.canonicalId.toLowerCase();
    if (ignored.has(key)) continue;
    if (!deduped.has(key)) deduped.set(key, r);
  }

  return {
    tenantId,
    providerRecommendations: providerRecs,
    modelRecommendations: [...deduped.values()],
  };
}
