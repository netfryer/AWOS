#!/usr/bin/env node
/**
 * Sync provider configs into Model HR registry.
 *
 * Adapter discovery (based on files in config/):
 * - models.<provider>.json -> JSONConfigAdapter (local config)
 * - models.<provider>.remote.json -> RemoteStubAdapter (stub; no network calls)
 *
 * Writes recruiting-report.json (same format as cycle) for consistency.
 * Output format: { tsISO, created, updated, skipped } (RecruitingReportItem[]).
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { runRecruitingSync } from "./syncLogic.js";

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

async function main(): Promise<void> {
  const { report, created, updated, skipped } = await runRecruitingSync();

  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "recruiting-report.json"),
    JSON.stringify(
      {
        tsISO: new Date().toISOString(),
        created: report.created,
        updated: report.updated,
        skipped: report.skipped,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`[sync] Created: ${created.length}, Updated: ${updated.length}, Skipped: ${skipped.length}`);
  console.log(`[sync] Wrote ${join(dataDir, "recruiting-report.json")}`);
}

main().catch((err) => {
  console.error("[sync] Error:", err);
  process.exit(1);
});
