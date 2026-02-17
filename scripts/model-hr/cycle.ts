#!/usr/bin/env node
/**
 * Model HR Cycle: canonical "HR daily cycle" orchestrator.
 *
 * 1. Recruiting step: run sync via RecruitingService, write recruiting-report.json
 * 2. Run canaries for models that need it (expanded selection)
 * 3. Termination Review: escalations/cost variance -> probation; probation+failing -> disable
 * 4. Promotion Review: probation + canary passes + priors meet -> active
 * 5. Apply changes only if --apply
 * 6. Write cycle-summary.json
 *
 * Usage:
 *   npm run model-hr:cycle
 *   npm run model-hr:cycle -- --apply --limit 5 --sinceDays 14
 *   npm run model-hr:cycle -- --terminateOnly --apply
 *   npm run model-hr:cycle -- --promoteOnly --apply
 *   npm run model-hr:cycle -- --apply --autoApproveDisable
 *
 * Options:
 *   --apply              Apply recommended status changes (default: dry-run)
 *   --autoApproveDisable With --apply, auto-approve disable actions (else enqueue only)
 *   --limit N            Max models to canary per run (default: 5)
 *   --sinceDays N   Recent window for created/signals (default: 14)
 *   --terminateOnly Only run termination actions (probation/disable)
 *   --promoteOnly   Only run promotion actions (graduate to active)
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  listModels,
  getModel,
  setModelStatus,
  disableModel,
  emitModelHrSignal,
  enqueueAction,
  runCanary,
  evaluateSuiteForStatusChange,
  loadPriorsForModel,
  readModelHrSignalsForModel,
} from "../../src/lib/model-hr/index.js";
import type { ModelRegistryEntry } from "../../src/lib/model-hr/types.js";
import { runRecruitingSync } from "./syncLogic.js";
import {
  needsCanary,
  countEscalations,
  priorsFailCostVariance,
  priorsMeetPromotionThresholds,
  type ModelHrSignal,
} from "./cycleSelection.js";

const DEFAULT_SINCE_DAYS = 14;
const SIGNAL_DAYS = 7;
const DEFAULT_MAX_ESCALATIONS = 2;

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

function parseArgs(): {
  apply: boolean;
  limit: number;
  sinceDays: number;
  terminateOnly: boolean;
  promoteOnly: boolean;
  autoApproveDisable: boolean;
} {
  const args = process.argv.slice(2);
  let apply = false;
  let limit = 5;
  let sinceDays = DEFAULT_SINCE_DAYS;
  let terminateOnly = false;
  let promoteOnly = false;
  let autoApproveDisable = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--autoApproveDisable") autoApproveDisable = true;
    else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n) && n >= 1) limit = Math.min(n, 100);
    } else if (args[i] === "--sinceDays" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n) && n >= 1) sinceDays = Math.min(n, 90);
    } else if (args[i] === "--terminateOnly") terminateOnly = true;
    else if (args[i] === "--promoteOnly") promoteOnly = true;
  }
  return { apply, limit, sinceDays, terminateOnly, promoteOnly, autoApproveDisable };
}

function toSelectionSignal(s: { modelId: string; reason: string; tsISO: string }): ModelHrSignal {
  return { modelId: s.modelId, reason: s.reason, tsISO: s.tsISO };
}

interface CycleRow {
  modelId: string;
  statusBefore: string;
  statusAfter: string;
  canaryAvgQuality: number;
  failedCount: number;
  action: string;
}

interface CycleSummary {
  tsISO: string;
  options: { apply: boolean; limit: number; sinceDays: number; terminateOnly: boolean; promoteOnly: boolean; autoApproveDisable: boolean };
  recruiting: { created: string[]; updated: string[]; skipped: string[] };
  canaryCount: number;
  rows: CycleRow[];
}

function pad(s: string, n: number): string {
  return s.padEnd(n).slice(0, n);
}

function printTable(rows: CycleRow[]): void {
  const w = { modelId: 26, statusBefore: 12, statusAfter: 12, avgQuality: 10, failed: 8, action: 18 };
  const total = w.modelId + w.statusBefore + w.statusAfter + w.avgQuality + w.failed + w.action;
  console.log("\n--- Model HR Cycle Summary ---");
  console.log(
    pad("modelId", w.modelId) +
      pad("statusBefore", w.statusBefore) +
      pad("statusAfter", w.statusAfter) +
      pad("avgQual", w.avgQuality) +
      pad("failed", w.failed) +
      pad("action", w.action)
  );
  console.log("-".repeat(total));
  for (const r of rows) {
    const avgStr = r.failedCount >= 0 ? r.canaryAvgQuality.toFixed(2) : "N/A";
    const failStr = r.failedCount >= 0 ? String(r.failedCount) : "err";
    console.log(
      pad(r.modelId, w.modelId) +
        pad(r.statusBefore, w.statusBefore) +
        pad(r.statusAfter, w.statusAfter) +
        pad(avgStr, w.avgQuality) +
        pad(failStr, w.failed) +
        pad(r.action, w.action)
    );
  }
}

async function main(): Promise<void> {
  const { apply, limit, sinceDays, terminateOnly, promoteOnly, autoApproveDisable } = parseArgs();
  console.log(`[cycle] apply=${apply}, limit=${limit}, sinceDays=${sinceDays}, terminateOnly=${terminateOnly}, promoteOnly=${promoteOnly}, autoApproveDisable=${autoApproveDisable}`);

  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });

  // 1. Recruiting step
  console.log("[cycle] Recruiting step...");
  const syncResult = await runRecruitingSync();
  await writeFile(
    join(dataDir, "recruiting-report.json"),
    JSON.stringify(
      {
        tsISO: new Date().toISOString(),
        created: syncResult.report.created,
        updated: syncResult.report.updated,
        skipped: syncResult.report.skipped,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`[cycle] Recruiting: created=${syncResult.created.length}, updated=${syncResult.updated.length}, skipped=${syncResult.skipped.length}`);

  const all = await listModels({ includeDisabled: false });
  const now = Date.now();

  const rows: CycleRow[] = [];
  let canaryCount = 0;

  if (terminateOnly) {
    // Termination only: no canaries, run termination review on all models
    console.log("[cycle] Termination review only...");
    for (const m of all) {
      const modelId = m.id;
      const statusBefore = m.identity.status;
      let statusAfter = statusBefore;
      let action = "skipped";

      const signals = await readModelHrSignalsForModel(modelId, 100);
      const sigs = signals.map((s) => toSelectionSignal(s));
      const escalationCount = countEscalations(sigs, sinceDays, now);
      const priors = await loadPriorsForModel(modelId);
      const gov = m.governance;
      const maxEsc = gov?.maxRecentEscalations ?? DEFAULT_MAX_ESCALATIONS;
      const maxCostRatio = gov?.maxCostVarianceRatio;
      const disableAutoDisable = gov?.disableAutoDisable === true;

      const costFails = priorsFailCostVariance(priors, maxCostRatio);
      const escalationFails = escalationCount >= maxEsc;

      if (escalationFails || costFails) {
        if (statusBefore !== "probation" && statusBefore !== "disabled") {
          action = "termination_review";
          statusAfter = "probation";
          if (apply) {
            const updated = await setModelStatus(modelId, "probation");
            if (updated) {
              emitModelHrSignal({
                modelId,
                previousStatus: statusBefore,
                newStatus: "probation",
                reason: "termination_review_started",
                sampleCount: escalationCount,
              });
              action = "termination_review_applied";
            }
          }
        } else if (statusBefore === "probation") {
          const minQP = gov?.minQualityPrior ?? 0.55;
          const priorsFailQuality = priors.some((p) => p.qualityPrior < minQP);
          if ((priorsFailQuality || costFails) && !disableAutoDisable) {
            action = "disable_recommended";
            statusAfter = "disabled";
            if (apply) {
              if (autoApproveDisable) {
                const updated = await disableModel(modelId, "termination_review_disable");
                if (updated) {
                  emitModelHrSignal({
                    modelId,
                    previousStatus: "probation",
                    newStatus: "disabled",
                    reason: "termination_review_disable",
                    sampleCount: escalationCount,
                  });
                  action = "disabled";
                }
              } else {
                try {
                  await enqueueAction(modelId, "disable", "termination_review_disable", "evaluation");
                  action = "disable_enqueued";
                } catch {
                  action = "disable_enqueue_failed";
                }
              }
            }
          }
        }
      }

      rows.push({
        modelId,
        statusBefore,
        statusAfter,
        canaryAvgQuality: 0,
        failedCount: -1,
        action,
      });
    }
  } else {
    // 2. Select canary candidates
    const candidates: ModelRegistryEntry[] = [];
    for (const m of all) {
      const signals = await readModelHrSignalsForModel(m.id, 100);
      const sigs = signals.map((s) => toSelectionSignal(s));
      if (needsCanary(m, sigs, sinceDays, SIGNAL_DAYS, now)) {
        candidates.push(m);
      }
    }
    const toCanary = candidates.slice(0, limit);
    canaryCount = toCanary.length;
    console.log(`[cycle] ${canaryCount} model(s) to canary (of ${candidates.length} eligible)`);

    for (const m of toCanary) {
    const modelId = m.id;
    const statusBefore = m.identity.status;
    let statusAfter = statusBefore;
    let canaryAvgQuality = 0;
    let failedCount = -1;
    let action = "skipped";

    try {
      const suiteResult = await runCanary({ modelId, suiteId: "default" });
      canaryAvgQuality = suiteResult.avgQuality;
      failedCount = suiteResult.failedCount;
      const policy = evaluateSuiteForStatusChange(modelId, suiteResult, m?.governance ?? undefined);

      // Promotion Review: probation + canary passes + priors meet -> active (or promoteOnly: only this)
      if (policy.action === "active" || policy.action === "probation") {
        if (policy.action === "active" && (promoteOnly || !terminateOnly)) {
          const current = await getModel(modelId);
          const priors = await loadPriorsForModel(modelId);
          const gov = current?.governance;
          const minQP = gov?.minQualityPrior ?? 0.75;
          const maxCost = gov?.maxCostVarianceRatio ?? 5;

          if (statusBefore === "probation" && priorsMeetPromotionThresholds(priors, minQP, maxCost)) {
            action = "promote_recommended";
            statusAfter = "active";
            if (apply) {
              const updated = await setModelStatus(modelId, "active");
              if (updated) {
                emitModelHrSignal({
                  modelId,
                  previousStatus: statusBefore,
                  newStatus: "active",
                  reason: "canary_graduate",
                  sampleCount: suiteResult.results.length,
                });
                action = "promoted";
              }
            }
          }
        }
        if (policy.action === "probation" && !promoteOnly && apply) {
          const updated = await setModelStatus(modelId, "probation");
          if (updated) {
            statusAfter = "probation";
            action = "probation_applied";
            emitModelHrSignal({
              modelId,
              previousStatus: statusBefore,
              newStatus: "probation",
              reason: policy.reason,
              sampleCount: suiteResult.results.length,
            });
          }
        } else if (!apply) {
          action = policy.action === "active" ? "promote_pending" : "probation_pending";
          statusAfter = policy.action;
        }
      }
    } catch (e) {
      console.error(`[cycle] Canary failed for ${modelId}:`, e instanceof Error ? e.message : String(e));
      action = "canary_error";
    }

    // Termination Review (when not promoteOnly)
    if (!promoteOnly) {
      const current = await getModel(modelId);
      const signals = await readModelHrSignalsForModel(modelId, 100);
      const sigs = signals.map((s) => toSelectionSignal(s));
      const escalationCount = countEscalations(sigs, sinceDays, now);
      const priors = await loadPriorsForModel(modelId);
      const gov = current?.governance;
      const maxEsc = gov?.maxRecentEscalations ?? DEFAULT_MAX_ESCALATIONS;
      const maxCostRatio = gov?.maxCostVarianceRatio;
      const disableAutoDisable = gov?.disableAutoDisable === true;

      const costFails = priorsFailCostVariance(priors, maxCostRatio);
      const escalationFails = escalationCount >= maxEsc;

      if (escalationFails || costFails) {
        if (statusBefore !== "probation" && statusBefore !== "disabled") {
          action = action === "skipped" ? "termination_review" : action;
          statusAfter = "probation";
          if (apply) {
            const updated = await setModelStatus(modelId, "probation");
            if (updated) {
              emitModelHrSignal({
                modelId,
                previousStatus: statusBefore,
                newStatus: "probation",
                reason: "termination_review_started",
                sampleCount: escalationCount,
              });
              action = "termination_review_applied";
            }
          }
        } else if (statusBefore === "probation") {
          const minQP = gov?.minQualityPrior ?? 0.55;
          const priorsFailQuality = priors.some((p) => p.qualityPrior < minQP);
          if ((priorsFailQuality || costFails) && !disableAutoDisable) {
            action = "disable_recommended";
            statusAfter = "disabled";
            if (apply) {
              if (autoApproveDisable) {
                const updated = await disableModel(modelId, "termination_review_disable");
                if (updated) {
                  emitModelHrSignal({
                    modelId,
                    previousStatus: "probation",
                    newStatus: "disabled",
                    reason: "termination_review_disable",
                    sampleCount: escalationCount,
                  });
                  action = "disabled";
                }
              } else {
                try {
                  await enqueueAction(modelId, "disable", "termination_review_disable", "evaluation");
                  action = "disable_enqueued";
                } catch {
                  action = "disable_enqueue_failed";
                }
              }
            }
          }
        }
      }
    }

    rows.push({
      modelId,
      statusBefore,
      statusAfter,
      canaryAvgQuality,
      failedCount,
      action,
    });
  }
  }

  printTable(rows);

  const summary: CycleSummary = {
    tsISO: new Date().toISOString(),
    options: { apply, limit, sinceDays, terminateOnly, promoteOnly, autoApproveDisable },
    recruiting: { created: syncResult.created, updated: syncResult.updated, skipped: syncResult.skipped },
    canaryCount,
    rows,
  };
  await writeFile(join(dataDir, "cycle-summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  console.log(`[cycle] Wrote ${join(dataDir, "cycle-summary.json")}`);

  if (!apply && rows.some((r) => r.statusBefore !== r.statusAfter)) {
    console.log("\n[cycle] Run with --apply to apply recommended status changes.");
  }
}

main().catch((e) => {
  console.error("[cycle] Error:", e);
  process.exit(1);
});
