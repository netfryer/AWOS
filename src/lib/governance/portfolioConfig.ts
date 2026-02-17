/**
 * In-memory portfolio mode config for portfolio-aware routing.
 * Singleton; used by portfolio-config endpoint and optionally by runWorkPackages callers.
 */

// ─── src/lib/governance/portfolioConfig.ts ───────────────────────────────────

export type PortfolioConfigMode = "off" | "prefer" | "lock";

let currentMode: PortfolioConfigMode = "off";

export function getPortfolioMode(): PortfolioConfigMode {
  return currentMode;
}

export function setPortfolioMode(mode: PortfolioConfigMode): void {
  currentMode = mode;
}
