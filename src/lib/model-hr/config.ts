/**
 * Model HR config: env-based getters with safe parsing and clamped defaults.
 * Defaults match current behavior; values are clamped to avoid footguns.
 */

function parseIntEnv(key: string, defaultVal: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return defaultVal;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

/** Observations cap per model (observations/{modelId}.json). Default 2000. */
export function getObservationsCap(): number {
  return parseIntEnv("MODEL_HR_OBSERVATIONS_CAP", 2000, 100, 50_000);
}

/** Priors sample size for evaluation (last N observations per taskType+difficulty). Default 100. */
export function getPriorsSampleSize(): number {
  return parseIntEnv("MODEL_HR_PRIORS_SAMPLE_SIZE", 100, 10, 2000);
}

/** Analytics observation cap (total across models). Default 5000. */
export function getAnalyticsObservationCap(): number {
  return parseIntEnv("MODEL_HR_ANALYTICS_OBSERVATION_CAP", 5000, 100, 100_000);
}

/** Signals retention in days (signals.jsonl). Default 30. */
export function getSignalsRetentionDays(): number {
  return parseIntEnv("MODEL_HR_SIGNALS_RETENTION_DAYS", 30, 1, 365);
}

/** Registry fallback retention in days (registry-fallback.jsonl). Default 30. */
export function getFallbackRetentionDays(): number {
  return parseIntEnv("MODEL_HR_FALLBACK_RETENTION_DAYS", 30, 1, 365);
}

/** Actions retention in days (actions.jsonl). Default 90. */
export function getActionsRetentionDays(): number {
  return parseIntEnv("MODEL_HR_ACTIONS_RETENTION_DAYS", 90, 1, 365);
}
