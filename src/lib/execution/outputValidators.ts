/**
 * Deterministic output-content validators per package type.
 * Validates worker output text without running shell commands.
 */

// ─── src/lib/execution/outputValidators.ts ───────────────────────────────────

export interface OutputValidationResult {
  pass: boolean;
  defects: string[];
}

/** Phrases that indicate placeholder/fabricated content; output fails if any appear. */
export const AGGREGATION_REPORT_BANNED_PHRASES = [
  "let's assume",
  "lets assume",
  "for this example",
  "sample dataset",
  "sample data",
  "fabricated",
  "placeholder data",
  "dummy data",
  "mock data",
  "hypothetical data",
] as const;

/** Required top-level keys in the JSON report. */
export const AGGREGATION_REPORT_REQUIRED_KEYS = ["summary", "aggregations"] as const;

/**
 * Attempts to extract a JSON object from worker output.
 * Looks for ```json blocks first, then bare { ... }.
 */
function extractJsonFromOutput(text: string): { ok: true; obj: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Output is empty" };

  // Try ```json ... ``` block first
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const obj = JSON.parse(jsonBlockMatch[1].trim());
      return { ok: true, obj };
    } catch {
      // Fall through to try raw JSON
    }
  }

  // Try to find a top-level JSON object (brace-balanced)
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = trimmed.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          return { ok: true, obj };
        } catch {
          // Try next object
        }
      }
    }
  }

  return { ok: false, reason: "No parseable JSON object found in output" };
}

/**
 * Validates aggregation-report worker output.
 * Checks: valid JSON, required keys (summary, aggregations), no banned phrases.
 */
export function validateAggregationReportOutput(output: string): OutputValidationResult {
  const defects: string[] = [];
  const lower = output.toLowerCase();

  // 1. Banned phrases
  for (const phrase of AGGREGATION_REPORT_BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      defects.push(`Output contains banned placeholder phrase: "${phrase}"`);
    }
  }

  // 2. Parse JSON
  const extracted = extractJsonFromOutput(output);
  if (!extracted.ok) {
    defects.push(`JSON validation failed: ${extracted.reason}`);
    return { pass: defects.length === 0, defects };
  }

  const obj = extracted.obj;
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    defects.push("JSON root must be an object, not array or primitive");
    return { pass: false, defects };
  }

  const keys = Object.keys(obj as Record<string, unknown>);

  // 3. Required keys
  for (const required of AGGREGATION_REPORT_REQUIRED_KEYS) {
    if (!keys.includes(required)) {
      defects.push(`JSON report missing required key: "${required}"`);
    }
  }

  // 4. Code blocks present when output suggests full deliverable (integration)
  if (output.length > 800 && !/```[\s\S]*?```/.test(output)) {
    defects.push("Full deliverable should include at least one code block (```...```)");
  }

  return {
    pass: defects.length === 0,
    defects,
  };
}

/** Package IDs that have output-content validators. */
export const OUTPUT_VALIDATOR_PACKAGE_IDS = ["aggregation-report"] as const;

/** Registry: packageId -> validator function. */
const VALIDATORS: Record<string, (output: string) => OutputValidationResult> = {
  "aggregation-report": validateAggregationReportOutput,
};

/**
 * Runs the output validator for the given package ID, if one exists.
 * Returns null when no validator is registered.
 */
export function runOutputValidator(
  packageId: string,
  output: string
): OutputValidationResult | null {
  const fn = VALIDATORS[packageId];
  if (!fn) return null;
  return fn(output);
}
