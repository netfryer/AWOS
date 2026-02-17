/**
 * Singleton cache for portfolio recommendations.
 * Avoids recomputing when args are unchanged and within TTL.
 */

// ─── src/lib/governance/portfolioCache.ts ────────────────────────────────────

import { recommendPortfolio, type PortfolioRecommendation } from "./portfolioOptimizer.js";
import type { RecommendPortfolioArgs } from "./portfolioOptimizer.js";

interface CacheEntry {
  recommendation: PortfolioRecommendation;
  cachedAtISO: string;
  cacheKey: string;
}

let cacheEntry: CacheEntry | null = null;
let forceRefreshNext = false;

/** Set flag so next getCachedPortfolio call will force refresh. Cleared after use. */
export function setForceRefreshNext(): void {
  forceRefreshNext = true;
}

function buildCacheKey(args: RecommendPortfolioArgs): string {
  const ids = [...args.modelRegistry.map((m) => m.id)].sort().join(",");
  const tf = args.trustFloors
    ? `${args.trustFloors.worker},${args.trustFloors.qa}`
    : "default";
  const mpq = args.minPredictedQuality ?? 0.72;
  return `${ids}|${tf}|${mpq}`;
}

/**
 * Returns cached portfolio or recomputes via recommendPortfolio().
 * @param args - Same as recommendPortfolio
 * @param ttlSeconds - Cache TTL; default 60
 * @param forceRefresh - If true, bypass cache and recompute
 */
export async function getCachedPortfolio(
  args: RecommendPortfolioArgs,
  ttlSeconds = 60,
  forceRefresh = false
): Promise<PortfolioRecommendation> {
  const key = buildCacheKey(args);
  const effectiveForce = forceRefresh || forceRefreshNext;
  if (forceRefreshNext) forceRefreshNext = false;

  if (!effectiveForce && cacheEntry) {
    const ageMs = Date.now() - new Date(cacheEntry.cachedAtISO).getTime();
    if (cacheEntry.cacheKey === key && ageMs < ttlSeconds * 1000) {
      return cacheEntry.recommendation;
    }
  }

  const recommendation = await recommendPortfolio(args);
  cacheEntry = {
    recommendation,
    cachedAtISO: new Date().toISOString(),
    cacheKey: key,
  };
  return recommendation;
}
