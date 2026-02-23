/**
 * Config for tuning proposals and auto-apply.
 * In-memory when file driver; DB-backed when PERSISTENCE_DRIVER=db.
 */

// ─── src/lib/observability/tuningConfig.ts ────────────────────────────────────

import { getPersistenceDriver } from "../persistence/driver.js";
import { getAppConfigDb, setAppConfigDb } from "../db/appConfigDb.js";

const KEY_ENABLED = "tuning_enabled";
const KEY_ALLOW_AUTO_APPLY = "tuning_allow_auto_apply";

let enabled = false;
let allowAutoApply = false;

export function isTuningEnabled(): boolean {
  return enabled;
}

export function setTuningEnabled(value: boolean): void {
  enabled = value;
  if (getPersistenceDriver() === "db") {
    void setAppConfigDb(KEY_ENABLED, value);
  }
}

export function isAllowAutoApply(): boolean {
  return allowAutoApply;
}

export function setAllowAutoApply(value: boolean): void {
  allowAutoApply = value;
  if (getPersistenceDriver() === "db") {
    void setAppConfigDb(KEY_ALLOW_AUTO_APPLY, value);
  }
}

/** Load tuning config from DB. Call at startup when PERSISTENCE_DRIVER=db. */
export async function loadTuningConfigFromDb(): Promise<void> {
  const e = await getAppConfigDb(KEY_ENABLED);
  if (typeof e === "boolean") enabled = e;
  const a = await getAppConfigDb(KEY_ALLOW_AUTO_APPLY);
  if (typeof a === "boolean") allowAutoApply = a;
}
