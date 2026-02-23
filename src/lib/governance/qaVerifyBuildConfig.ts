/**
 * QA build verification mode for aggregation-report deliverables.
 * Controls whether and how we verify TypeScript compiles.
 *
 * - none: No compile check. Deterministic output validation only. Never runs npm install.
 * - tsc_no_install: Run tsc --noEmit. Never runs npm install. Module resolution
 *   failures are reported as warnings, not hard-fails (external deps not verified).
 * - sandbox_install_build: (Future) Run install + build in sandboxed container.
 *   Not implemented; requires sandbox infrastructure.
 *
 * Config: QA_VERIFY_BUILD_MODE env var, or setQaVerifyBuildMode().
 */

// ─── src/lib/governance/qaVerifyBuildConfig.ts ────────────────────────────────

export type QaVerifyBuildMode = "none" | "tsc_no_install" | "sandbox_install_build";

const DEFAULT_MODE: QaVerifyBuildMode = "none";

const VALID_MODES: QaVerifyBuildMode[] = ["none", "tsc_no_install", "sandbox_install_build"];

let currentMode: QaVerifyBuildMode = DEFAULT_MODE;

function parseEnvMode(): QaVerifyBuildMode | null {
  const v = process.env.QA_VERIFY_BUILD_MODE?.trim().toLowerCase();
  if (!v) return null;
  if (VALID_MODES.includes(v as QaVerifyBuildMode)) return v as QaVerifyBuildMode;
  return null;
}

export function getQaVerifyBuildMode(): QaVerifyBuildMode {
  const env = parseEnvMode();
  return env ?? currentMode;
}

export function setQaVerifyBuildMode(mode: QaVerifyBuildMode): void {
  currentMode = mode;
}
