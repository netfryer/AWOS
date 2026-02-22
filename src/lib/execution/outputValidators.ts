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

/** Extracts all JSON objects from output: fenced ```json blocks and brace-balanced inline/trailing objects. */
function extractAllJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  const seen = new Set<string>();

  function tryAdd(obj: unknown): void {
    try {
      const key = JSON.stringify(obj);
      if (seen.has(key)) return;
      seen.add(key);
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        results.push(obj);
      }
    } catch {
      // skip
    }
  }

  // 1. Fenced ```json blocks
  const jsonBlockRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = jsonBlockRe.exec(text)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      tryAdd(obj);
    } catch {
      // try parsing as multiple objects or partial
      const objs = extractBraceBalancedObjects(raw);
      for (const o of objs) tryAdd(o);
    }
  }

  // 2. Brace-balanced objects in the full text
  const objs = extractBraceBalancedObjects(text);
  for (const o of objs) tryAdd(o);

  return results;
}

function extractBraceBalancedObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = text.slice(start, i + 1);
        try {
          results.push(JSON.parse(slice));
        } catch {
          // skip
        }
      }
    }
  }
  return results;
}

function isSelfConfidenceOnly(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  const keys = Object.keys(obj as Record<string, unknown>);
  return keys.length === 1 && keys[0] === "selfConfidence" && typeof (obj as Record<string, unknown>).selfConfidence === "number";
}

function hasRequiredKeys(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  const keys = Object.keys(obj as Record<string, unknown>);
  return AGGREGATION_REPORT_REQUIRED_KEYS.every((k) => keys.includes(k));
}

/**
 * Validates aggregation-report worker output.
 * Extracts all JSON objects, ignores { selfConfidence }, picks first with summary+aggregations.
 * Checks: no banned phrases, at least one valid report object.
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

  // 2. Extract all JSON objects; ignore { selfConfidence }; pick first with required keys
  const candidates = extractAllJsonObjects(output);
  const report = candidates.find(
    (o) => !isSelfConfidenceOnly(o) && hasRequiredKeys(o)
  ) as Record<string, unknown> | undefined;

  if (!report) {
    const hasAny = candidates.length > 0;
    const onlySelfConf = candidates.every(isSelfConfidenceOnly);
    if (!hasAny) {
      defects.push("No parseable JSON object found in output");
    } else if (onlySelfConf) {
      defects.push("JSON report missing required keys: \"summary\" and \"aggregations\"");
    } else {
      defects.push("No JSON object with required keys \"summary\" and \"aggregations\" found");
    }
  }

  // 3. Code blocks present when output suggests full deliverable (integration)
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
