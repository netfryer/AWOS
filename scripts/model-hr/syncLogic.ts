/**
 * Recruiting sync logic: discover adapters, run processProviderModels, return report.
 * Used by syncProviders.ts and cycle.ts.
 *
 * Adapters are discovered from config/:
 * - models.<provider>.json -> JSONConfigAdapter (local config)
 * - models.<provider>.remote.json -> RemoteStubAdapter (stub; no network calls)
 *
 * Output format (combined JSON report):
 * - report: { created, updated, skipped } (flat RecruitingReport)
 * - byProvider: { [providerId]: { created, updated, skipped, errors } }
 * - created, updated, skipped: canonicalIds (backward compat)
 */

import { join } from "path";
import {
  discoverAdapters,
  ProviderModelSchema,
  type ProviderModel,
} from "../../src/lib/model-hr/recruiting/providerAdapters/index.js";
import { processProviderModels, type ProviderModelInput, type RecruitingReport, type RecruitingReportItem } from "../../src/lib/model-hr/index.js";

const CONFIG_DIR = join(process.cwd(), "config");

function toProviderModelInput(model: ProviderModel): ProviderModelInput {
  return {
    modelId: model.modelId,
    displayName: model.displayName,
    pricing: {
      inPer1k: model.pricing.inPer1k,
      outPer1k: model.pricing.outPer1k,
      currency: model.pricing.currency,
      minimumChargeUSD: model.pricing.minimumChargeUSD,
      roundingRule: model.pricing.roundingRule,
    },
    allowedTiers: model.allowedTiers,
    expertise: model.expertise,
    reliability: model.reliability,
    aliases: model.aliases,
  };
}

function mergeAndDedupeModels(models: ProviderModel[]): ProviderModel[] {
  const byId = new Map<string, ProviderModel>();
  for (const m of models) {
    byId.set(m.modelId, m);
  }
  return [...byId.values()];
}

export interface ProviderSyncResult {
  created: RecruitingReportItem[];
  updated: RecruitingReportItem[];
  skipped: RecruitingReportItem[];
  errors: string[];
}

export interface RecruitingSyncResult {
  report: RecruitingReport;
  created: string[];
  updated: string[];
  skipped: string[];
  byProvider: Record<string, ProviderSyncResult>;
}

export async function runRecruitingSync(): Promise<RecruitingSyncResult> {
  const report: RecruitingReport = { created: [], updated: [], skipped: [] };
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const byProvider: Record<string, ProviderSyncResult> = {};

  const adapters = await discoverAdapters(CONFIG_DIR);

  const adaptersByProvider = new Map<string, typeof adapters>();
  for (const a of adapters) {
    const list = adaptersByProvider.get(a.providerId) ?? [];
    list.push(a);
    adaptersByProvider.set(a.providerId, list);
  }

  for (const [providerId, providerAdapters] of adaptersByProvider) {
    const providerResult: ProviderSyncResult = { created: [], updated: [], skipped: [], errors: [] };
    let allModels: ProviderModel[] = [];

    for (const adapter of providerAdapters) {
      try {
        const models = await adapter.listModels();
        const validated: ProviderModel[] = [];
        for (const m of models) {
          const parsed = ProviderModelSchema.safeParse(m);
          if (parsed.success) {
            validated.push(parsed.data);
          } else {
            providerResult.errors.push(`Validation failed for ${m.modelId}: ${parsed.error.message}`);
          }
        }
        allModels = allModels.concat(validated);
      } catch (e) {
        providerResult.errors.push(
          `Adapter ${adapter.providerId} failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const merged = mergeAndDedupeModels(allModels);
    if (merged.length === 0 && providerResult.errors.length === 0) continue;

    if (merged.length > 0) {
      try {
        const inputs = merged.map(toProviderModelInput);
        const providerReport = await processProviderModels(providerId, inputs);

        providerResult.created = providerReport.created;
        providerResult.updated = providerReport.updated;
        providerResult.skipped = providerReport.skipped;

        report.created.push(...providerReport.created);
        report.updated.push(...providerReport.updated);
        report.skipped.push(...providerReport.skipped);

        for (const item of providerReport.created) created.push(item.canonicalId);
        for (const item of providerReport.updated) updated.push(item.canonicalId);
        for (const item of providerReport.skipped) skipped.push(item.canonicalId);
      } catch (e) {
        providerResult.errors.push(
          `processProviderModels failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    byProvider[providerId] = providerResult;
  }

  return { report, created, updated, skipped, byProvider };
}
