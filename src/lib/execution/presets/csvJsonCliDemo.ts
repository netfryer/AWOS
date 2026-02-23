/**
 * CSV → JSON Stats CLI demo preset.
 * Demonstrates multi-worker parallelization: strategy (premium) → 3 workers (cheap) → aggregation → QA.
 */

import type { AtomicWorkPackage } from "../../planning/packageWork.js";

const DIRECTIVE = "Build a CLI tool that parses CSV files and outputs JSON statistics.";

const STRATEGY_CRITERIA = [
  "Define architecture: module boundaries (parser, stats, cli), data flow, and interfaces",
  "Specify acceptance criteria for each module (parser output format, stats schema, CLI args)",
  "Document input CSV format expectations and output JSON structure",
];

const WORKER_CRITERIA = [
  "Code is runnable Node/TS; no placeholder implementations",
  "Output conforms to interface defined in strategy",
  "Edge cases (empty file, malformed CSV) are addressed",
];

const AGGREGATION_CRITERIA = [
  "Output includes valid JSON report with summary and (aggregations or aggregationsSchema or exampleAggregations)",
  "File tree + code blocks for key files (parser, stats, cli); README with usage examples",
  "No placeholder language (e.g. 'let's assume'); README placeholders like <path-to-file> are acceptable",
];

const QA_CRITERIA = [
  "QA output includes pass (boolean), qualityScore (0..1), defects (string[])",
  "Defects reference acceptance criteria; qualityScore reflects objective assessment",
];

/** Strategy package: premium tier, produces architecture and acceptance criteria. */
const STRATEGY: AtomicWorkPackage = {
  id: "strategy",
  role: "Worker",
  name: "Strategy: Architecture + Module Boundaries",
  description: "Define architecture, module boundaries, and acceptance criteria for the CSV→JSON CLI.",
  acceptanceCriteria: STRATEGY_CRITERIA,
  inputs: { directive: DIRECTIVE },
  outputs: { architecture: "string", acceptanceCriteria: "string[]" },
  dependencies: [],
  estimatedTokens: 1200,
  tierProfileOverride: "premium",
  taskType: "strategy",
  difficulty: "high",
  importance: 5,
};

/** Worker 1: CSV parser. */
const WORKER_1: AtomicWorkPackage = {
  id: "worker-1",
  role: "Worker",
  name: "CSV Parser Implementation",
  description: "Implement CSV parsing module per strategy; validate format, produce structured rows.",
  acceptanceCriteria: WORKER_CRITERIA,
  inputs: { directive: DIRECTIVE, strategyOutput: "from strategy" },
  outputs: { code: "string", status: "complete" },
  dependencies: ["strategy"],
  estimatedTokens: 800,
  tierProfileOverride: "cheap",
  cheapestViableChosen: true,
  taskType: "implementation",
  difficulty: "medium",
  importance: 3,
};

/** Worker 2: Stats aggregation. */
const WORKER_2: AtomicWorkPackage = {
  id: "worker-2",
  role: "Worker",
  name: "Stats Aggregation Module",
  description: "Implement stats aggregation per strategy; produce JSON with summary and aggregations.",
  acceptanceCriteria: WORKER_CRITERIA,
  inputs: { directive: DIRECTIVE, strategyOutput: "from strategy" },
  outputs: { code: "string", status: "complete" },
  dependencies: ["strategy"],
  estimatedTokens: 800,
  tierProfileOverride: "cheap",
  cheapestViableChosen: true,
  taskType: "implementation",
  difficulty: "medium",
  importance: 3,
};

/** Worker 3: CLI entrypoint. */
const WORKER_3: AtomicWorkPackage = {
  id: "worker-3",
  role: "Worker",
  name: "CLI Entrypoint + Arg Parsing",
  description: "Implement CLI entrypoint and argument parsing; wire parser and stats modules.",
  acceptanceCriteria: WORKER_CRITERIA,
  inputs: { directive: DIRECTIVE, strategyOutput: "from strategy" },
  outputs: { code: "string", status: "complete" },
  dependencies: ["strategy"],
  estimatedTokens: 800,
  tierProfileOverride: "cheap",
  cheapestViableChosen: true,
  taskType: "implementation",
  difficulty: "medium",
  importance: 3,
};

/** Aggregation: integrates outputs into final deliverable. */
const AGGREGATION: AtomicWorkPackage = {
  id: "aggregation-report",
  role: "Worker",
  name: "Integration Deliverable",
  description:
    "Integrate worker outputs into final deliverable: file tree, code blocks for key files, README with usage examples, JSON schema for output format.",
  acceptanceCriteria: AGGREGATION_CRITERIA,
  inputs: { directive: DIRECTIVE, workerOutputs: "from worker-1, worker-2, worker-3" },
  outputs: { fileTree: "string", codeBlocks: "string[]", readme: "string", jsonSchema: "object" },
  dependencies: ["worker-1", "worker-2", "worker-3"],
  estimatedTokens: 1500,
  tierProfileOverride: "standard",
  taskType: "implementation",
  difficulty: "medium",
  importance: 4,
};

/** QA: deterministic + optional LLM on final integration. */
const QA_REVIEW: AtomicWorkPackage = {
  id: "qa-review",
  role: "QA",
  name: "QA: Integration Review",
  description: "Validate integration deliverable against acceptance criteria.",
  acceptanceCriteria: QA_CRITERIA,
  inputs: { workerOutput: "from aggregation-report", acceptanceCriteria: AGGREGATION_CRITERIA },
  outputs: { pass: "boolean", qualityScore: "number", defects: "string[]" },
  dependencies: ["aggregation-report"],
  estimatedTokens: 400,
  importance: 4,
};

/** Preset: CSV → JSON Stats CLI demo packages. */
export const CSV_JSON_CLI_DEMO_PACKAGES: AtomicWorkPackage[] = [
  STRATEGY,
  WORKER_1,
  WORKER_2,
  WORKER_3,
  AGGREGATION,
  QA_REVIEW,
];

export const CSV_JSON_CLI_DEMO_DIRECTIVE = DIRECTIVE;
