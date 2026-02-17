/**
 * Minimal fallback models used ONLY when Model HR registry is unavailable.
 * NOT for use in scripts/seed or test fixtures - use SAMPLE_MODELS there.
 */

import type { ModelSpec } from "../../types.js";

/** Minimal models for runtime fallback when registry throws or returns empty. */
export const FALLBACK_MODELS: ModelSpec[] = [
  {
    id: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    expertise: { code: 0.78, writing: 0.75, analysis: 0.76, general: 0.77 },
    pricing: { inPer1k: 0.00015, outPer1k: 0.0006 },
    reliability: 0.97,
  },
  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    expertise: { code: 0.92, writing: 0.88, analysis: 0.9, general: 0.9 },
    pricing: { inPer1k: 0.0025, outPer1k: 0.01 },
    reliability: 0.98,
  },
];
