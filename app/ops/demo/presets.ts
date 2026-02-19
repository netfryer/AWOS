// Shared preset definitions for Demo mode. Single source of truth for directive text.

import type { DemoPreset, DemoPresetId } from "./types";

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: "csv-json-cli-demo",
    name: "CSV → JSON Stats CLI",
    description: "Strategy (premium) + 3 workers (cheap) + aggregation + QA",
    directive: "Build a CLI tool that parses CSV files and outputs JSON statistics.",
  },
];

export function getPresetById(id: DemoPresetId | null): DemoPreset | undefined {
  return id ? DEMO_PRESETS.find((p) => p.id === id) : undefined;
}

/** Pipeline hint for parallelism context, keyed by preset. */
export const PRESET_PIPELINE_HINTS: Record<DemoPresetId, string> = {
  "csv-json-cli-demo": "Strategy (1) → 3 workers (parallel) → aggregation (1) → QA (1)",
};
