/**
 * Deterministic output-content validators per package type.
 * Validates worker output text without running shell commands.
 */

// ─── src/lib/execution/outputValidators.ts ───────────────────────────────────

export interface OutputValidationResult {
  pass: boolean;
  defects: string[];
}

export interface StructuredAggregationValidationResult {
  pass: boolean;
  defects: string[];
  qualityScore: number;
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

/** Required top-level keys for aggregation-report strict JSON schema. */
export const AGGREGATION_REPORT_STRICT_KEYS = ["fileTree", "files", "report"] as const;

/** Required keys inside report object. */
export const AGGREGATION_REPORT_REQUIRED_KEYS = ["summary", "aggregations"] as const;

/** Required file paths for a compilable aggregation-report deliverable. */
export const AGGREGATION_REPORT_REQUIRED_FILES = [
  "package.json",
  "tsconfig.json",
  "src/parser.ts",
  "src/stats.ts",
  "src/cli.ts",
  "src/index.ts",
  "README.md",
] as const;

/**
 * Validates package.json content: devDependencies.typescript, scripts.build, scripts.start.
 * Returns defects; empty array if valid.
 */
function validatePackageJsonContent(pkgJsonContent: string): string[] {
  const defects: string[] = [];
  let pkg: unknown;
  try {
    pkg = JSON.parse(pkgJsonContent);
  } catch {
    defects.push("package.json must be valid JSON");
    return defects;
  }
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) {
    defects.push("package.json must be a JSON object");
    return defects;
  }
  const obj = pkg as Record<string, unknown>;
  const devDeps = obj.devDependencies;
  if (typeof devDeps !== "object" || devDeps === null || Array.isArray(devDeps)) {
    defects.push("package.json must include devDependencies");
  } else if (!("typescript" in devDeps) || typeof (devDeps as Record<string, unknown>).typescript !== "string") {
    defects.push("package.json devDependencies must include typescript");
  }
  const scripts = obj.scripts;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    defects.push("package.json must include scripts");
  } else {
    if (!("build" in scripts) || typeof (scripts as Record<string, unknown>).build !== "string") {
      defects.push("package.json scripts must include build");
    }
    if (!("start" in scripts) || typeof (scripts as Record<string, unknown>).start !== "string") {
      defects.push("package.json scripts must include start");
    }
  }
  return defects;
}

function hasStrictSchema(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  const keys = Object.keys(obj as Record<string, unknown>);
  if (!AGGREGATION_REPORT_STRICT_KEYS.every((k) => keys.includes(k))) return false;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.fileTree)) return false;
  if (typeof o.files !== "object" || o.files === null || Array.isArray(o.files)) return false;
  const report = o.report;
  if (typeof report !== "object" || report === null || Array.isArray(report)) return false;
  const reportKeys = Object.keys(report as Record<string, unknown>);
  if (!AGGREGATION_REPORT_REQUIRED_KEYS.every((k) => reportKeys.includes(k))) return false;
  return true;
}

function validateStrictAggregationReport(obj: Record<string, unknown>): string[] {
  const defects: string[] = [];
  const fileTree = obj.fileTree as unknown;
  const files = obj.files as Record<string, unknown>;
  const report = obj.report as Record<string, unknown>;

  if (!Array.isArray(fileTree)) {
    defects.push('"fileTree" must be an array of strings');
  } else {
    const fileKeys = new Set(Object.keys(files ?? {}));
    const treeSet = new Set(fileTree.map((p) => String(p)));
    for (const k of fileKeys) {
      if (!treeSet.has(k)) defects.push(`fileTree missing path: "${k}"`);
    }
    for (const p of fileTree) {
      const s = String(p);
      if (!(s in (files ?? {}))) defects.push(`files missing entry for fileTree path: "${s}"`);
    }
    for (const req of AGGREGATION_REPORT_REQUIRED_FILES) {
      if (!fileKeys.has(req)) {
        defects.push(`Required file missing: "${req}"`);
      }
    }
    const pkgJson = files?.["package.json"];
    if (typeof pkgJson === "string") {
      defects.push(...validatePackageJsonContent(pkgJson));
    }
  }

  if (typeof report?.summary !== "string") {
    defects.push('"report.summary" must be a string');
  }
  if (report?.aggregations == null || typeof report.aggregations !== "object") {
    defects.push('"report.aggregations" must be an object');
  }

  return defects;
}

/**
 * Validates aggregation-report worker output.
 * Expects a single strict JSON object: { fileTree, files, report }.
 * No markdown, no code fences, no selfConfidence.
 */
export function validateAggregationReportOutput(output: string): OutputValidationResult {
  const defects: string[] = [];
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();

  // 1. Banned phrases
  for (const phrase of AGGREGATION_REPORT_BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      defects.push(`Output contains banned placeholder phrase: "${phrase}"`);
    }
  }

  // 2. Reject code fences (output must be raw JSON only)
  if (/```/.test(trimmed)) {
    defects.push("Output must not contain code fences (```)");
  }

  // 3. Parse single JSON object
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    defects.push("Output must be a single valid JSON object parseable by JSON.parse");
    return { pass: defects.length === 0, defects };
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    defects.push("Output must be a JSON object, not array or primitive");
    return { pass: defects.length === 0, defects };
  }

  const record = obj as Record<string, unknown>;

  // 4. Strict schema
  if (!hasStrictSchema(record)) {
    defects.push(
      'Output must have top-level keys: "fileTree" (string[]), "files" (object), "report" (object with "summary" and "aggregations")'
    );
    return { pass: defects.length === 0, defects };
  }

  defects.push(...validateStrictAggregationReport(record));

  return {
    pass: defects.length === 0,
    defects,
  };
}

/**
 * Validates a strict structured JSON artifact for aggregation-report.
 * Entire output must be valid JSON conforming to { fileTree, files, report }.
 * Returns pass, defects, and qualityScore (>= 0.85 if valid, <= 0.4 if invalid).
 */
export function validateStructuredAggregationArtifact(
  output: string
): StructuredAggregationValidationResult {
  const defects: string[] = [];
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();

  // 1. Banned phrases
  for (const phrase of AGGREGATION_REPORT_BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      defects.push(`Output contains banned placeholder phrase: "${phrase}"`);
    }
  }

  // 2. Reject markdown fences
  if (/```/.test(trimmed)) {
    defects.push("Output must not contain markdown code fences");
  }

  // 3. JSON.parse must succeed
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    defects.push("Output must be valid JSON parseable by JSON.parse");
    return { pass: false, defects, qualityScore: 0.4 };
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    defects.push("Output must be a JSON object, not array or primitive");
    return { pass: false, defects, qualityScore: 0.4 };
  }

  const record = obj as Record<string, unknown>;

  // 4. Top-level shape
  if (!AGGREGATION_REPORT_STRICT_KEYS.every((k) => k in record)) {
    defects.push(
      'Output must have top-level keys: "fileTree" (string[]), "files" (object), "report" (object with "summary" and "aggregations")'
    );
    return { pass: false, defects, qualityScore: 0.4 };
  }

  // 5. fileTree must be array of strings
  const fileTree = record.fileTree;
  if (!Array.isArray(fileTree)) {
    defects.push('"fileTree" must be an array of strings');
  } else {
    for (let i = 0; i < fileTree.length; i++) {
      if (typeof fileTree[i] !== "string") {
        defects.push(`"fileTree"[${i}] must be a string`);
      }
    }
  }

  // 6. files must contain matching keys for each fileTree entry; fileTree must list every key in files
  const files = record.files as Record<string, unknown> | null | undefined;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    defects.push('"files" must be an object');
  } else if (Array.isArray(fileTree)) {
    const fileKeys = new Set(Object.keys(files));
    const treeSet = new Set(fileTree.map((p) => String(p)));
    for (const p of fileTree) {
      const path = String(p);
      if (!fileKeys.has(path)) {
        defects.push(`"files" missing entry for fileTree path: "${path}"`);
      }
    }
    for (const k of Object.keys(files)) {
      if (!treeSet.has(k)) {
        defects.push(`"fileTree" missing path: "${k}"`);
      }
    }
    for (const req of AGGREGATION_REPORT_REQUIRED_FILES) {
      if (!fileKeys.has(req)) {
        defects.push(`Required file missing: "${req}"`);
      }
    }
    const pkgJson = files["package.json"];
    if (typeof pkgJson === "string") {
      defects.push(...validatePackageJsonContent(pkgJson));
    }
  }

  // 7. report.summary must exist and be string
  const report = record.report as Record<string, unknown> | null | undefined;
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    defects.push('"report" must be an object');
  } else {
    if (!("summary" in report)) {
      defects.push('"report.summary" must exist');
    } else if (typeof report.summary !== "string") {
      defects.push('"report.summary" must be a string');
    }
    if (!("aggregations" in report)) {
      defects.push('"report.aggregations" must exist');
    } else if (report.aggregations == null || typeof report.aggregations !== "object") {
      defects.push('"report.aggregations" must be an object');
    }
  }

  const pass = defects.length === 0;
  const qualityScore = pass ? 0.85 : 0.4;

  return {
    pass,
    defects,
    qualityScore,
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
