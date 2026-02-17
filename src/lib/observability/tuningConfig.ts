/**
 * Singleton config for tuning proposals and auto-apply.
 * In-memory only.
 */

// ─── src/lib/observability/tuningConfig.ts ────────────────────────────────────

let enabled = false;
let allowAutoApply = false;

export function isTuningEnabled(): boolean {
  return enabled;
}

export function setTuningEnabled(value: boolean): void {
  enabled = value;
}

export function isAllowAutoApply(): boolean {
  return allowAutoApply;
}

export function setAllowAutoApply(value: boolean): void {
  allowAutoApply = value;
}
