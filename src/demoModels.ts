/**
 * Shared demo models and config for scripts and UI.
 */

import type { ModelSpec, RouterConfig } from "./types.js";

export const SAMPLE_MODELS: ModelSpec[] = [
  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    expertise: { code: 0.92, writing: 0.88, analysis: 0.9, general: 0.9 },
    pricing: { inPer1k: 0.0025, outPer1k: 0.01 },
    reliability: 0.98,
  },
  {
    id: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    expertise: { code: 0.78, writing: 0.75, analysis: 0.76, general: 0.77 },
    pricing: { inPer1k: 0.00015, outPer1k: 0.0006 },
    reliability: 0.97,
  },
  {
    id: "claude-sonnet-4-5-20250929",
    displayName: "Claude Sonnet",
    expertise: { code: 0.85, writing: 0.9, analysis: 0.88, general: 0.86 },
    pricing: { inPer1k: 0.003, outPer1k: 0.015 },
    reliability: 0.96,
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku",
    expertise: { code: 0.72, writing: 0.74, analysis: 0.71, general: 0.73 },
    pricing: { inPer1k: 0.00025, outPer1k: 0.00125 },
    reliability: 0.95,
  },
  {
    id: "claude-3-haiku-20240307",
    displayName: "Claude Haiku 3",
    pricing: {
      inPer1k: 0.00025,
      outPer1k: 0.00125,
    },
    reliability: 0.95,
    expertise: {
      general: 0.7,
      writing: 0.72,
      analysis: 0.68,
      code: 0.65,
    },
  },
];

export const DEMO_CONFIG: RouterConfig = {
  thresholds: { low: 0.7, medium: 0.8, high: 0.88 },
  baseTokenEstimates: {
    input: { code: 2500, writing: 2000, analysis: 3000, general: 2000 },
    output: { code: 1500, writing: 1000, analysis: 2000, general: 1000 },
  },
  difficultyMultipliers: { low: 1, medium: 1.2, high: 1.5 },
  fallbackCount: 2,
  onBudgetFail: "best_effort_within_budget",
};
