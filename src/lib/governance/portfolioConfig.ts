/**
 * Portfolio mode config for portfolio-aware routing.
 * In-memory when file driver; DB-backed when PERSISTENCE_DRIVER=db.
 */

// ─── src/lib/governance/portfolioConfig.ts ───────────────────────────────────

import { getPersistenceDriver } from "../persistence/driver.js";
import { getAppConfigDb, setAppConfigDb } from "../db/appConfigDb.js";

const APP_CONFIG_KEY = "portfolio_mode";

export type PortfolioConfigMode = "off" | "prefer" | "lock";

let currentMode: PortfolioConfigMode = "off";

export function getPortfolioMode(): PortfolioConfigMode {
  return currentMode;
}

export function setPortfolioMode(mode: PortfolioConfigMode): void {
  currentMode = mode;
  if (getPersistenceDriver() === "db") {
    void setAppConfigDb(APP_CONFIG_KEY, mode);
  }
}

/** Load portfolio mode from DB. Call at startup when PERSISTENCE_DRIVER=db. */
export async function loadPortfolioConfigFromDb(): Promise<void> {
  const v = await getAppConfigDb(APP_CONFIG_KEY);
  if (v === "off" || v === "prefer" || v === "lock") {
    currentMode = v;
  }
}
