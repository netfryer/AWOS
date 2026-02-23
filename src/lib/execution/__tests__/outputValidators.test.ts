import { describe, it, expect } from "vitest";
import {
  validateAggregationReportOutput,
  validateStructuredAggregationArtifact,
  runOutputValidator,
  AGGREGATION_REPORT_BANNED_PHRASES,
  AGGREGATION_REPORT_REQUIRED_FILES,
} from "../outputValidators.js";

const VALID_STRICT_JSON = JSON.stringify({
  fileTree: [
    "package.json",
    "tsconfig.json",
    "src/parser.ts",
    "src/stats.ts",
    "src/cli.ts",
    "src/index.ts",
    "README.md",
  ],
  files: {
    "package.json": "{\"name\":\"stats-cli\",\"devDependencies\":{\"typescript\":\"^5.0.0\"},\"scripts\":{\"build\":\"tsc\",\"start\":\"node dist/index.js\"}}",
    "tsconfig.json": "{\"compilerOptions\":{\"outDir\":\"dist\"}}",
    "src/parser.ts": "export function parse() {}",
    "src/stats.ts": "export function stats() {}",
    "src/cli.ts": "export function cli() {}",
    "src/index.ts": "console.log('hello');",
    "README.md": "# Stats CLI",
  },
  report: {
    summary: "CLI parses CSV and outputs JSON stats.",
    aggregations: { count: 0 },
  },
});

describe("validateAggregationReportOutput", () => {
  it("passes for valid strict JSON schema", () => {
    const r = validateAggregationReportOutput(VALID_STRICT_JSON);
    expect(r.pass).toBe(true);
    expect(r.defects).toHaveLength(0);
  });

  it("fails when output contains banned phrases", () => {
    for (const phrase of AGGREGATION_REPORT_BANNED_PHRASES) {
      const bad = JSON.stringify({
        fileTree: ["x.ts"],
        files: { "x.ts": phrase },
        report: { summary: "ok", aggregations: {} },
      });
      const r = validateAggregationReportOutput(bad);
      expect(r.pass).toBe(false);
      expect(r.defects.some((d) => d.includes(phrase))).toBe(true);
    }
  });

  it("fails when output contains code fences", () => {
    const bad = "```json\n" + VALID_STRICT_JSON + "\n```";
    const r = validateAggregationReportOutput(bad);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("code fences"))).toBe(true);
  });

  it("fails when JSON is invalid", () => {
    const invalidJson = "Not valid JSON: { summary: 1, aggregations";
    const r = validateAggregationReportOutput(invalidJson);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("JSON") || d.includes("parseable"))).toBe(true);
  });

  it("fails when missing top-level keys", () => {
    const missing = '{"fileTree":[],"files":{}}';
    const r = validateAggregationReportOutput(missing);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("report"))).toBe(true);
  });

  it("fails when report missing summary", () => {
    const missing = JSON.stringify({
      fileTree: ["x.ts"],
      files: { "x.ts": "x" },
      report: { aggregations: {} },
    });
    const r = validateAggregationReportOutput(missing);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("summary"))).toBe(true);
  });

  it("fails when report missing aggregations", () => {
    const missing = JSON.stringify({
      fileTree: ["x.ts"],
      files: { "x.ts": "x" },
      report: { summary: "ok" },
    });
    const r = validateAggregationReportOutput(missing);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("aggregations"))).toBe(true);
  });

  it("fails when fileTree does not match files keys", () => {
    const bad = JSON.stringify({
      fileTree: ["a.ts"],
      files: { "a.ts": "x", "b.ts": "y" },
      report: { summary: "ok", aggregations: {} },
    });
    const r = validateAggregationReportOutput(bad);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("fileTree") || d.includes("files"))).toBe(true);
  });

  it("fails when required file is missing", () => {
    const missing = JSON.stringify({
      fileTree: ["package.json", "src/index.ts"],
      files: {
        "package.json": "{\"devDependencies\":{\"typescript\":\"^5.0.0\"},\"scripts\":{\"build\":\"tsc\",\"start\":\"node dist/index.js\"}}",
        "src/index.ts": "x",
      },
      report: { summary: "ok", aggregations: {} },
    });
    const r = validateAggregationReportOutput(missing);
    expect(r.pass).toBe(false);
    for (const req of AGGREGATION_REPORT_REQUIRED_FILES) {
      if (req !== "package.json" && req !== "src/index.ts") {
        expect(r.defects.some((d) => d.includes(req))).toBe(true);
      }
    }
  });

  it("fails when package.json lacks devDependencies.typescript", () => {
    const bad = JSON.stringify({
      fileTree: AGGREGATION_REPORT_REQUIRED_FILES,
      files: Object.fromEntries(
        AGGREGATION_REPORT_REQUIRED_FILES.map((p) => [
          p,
          p === "package.json"
            ? "{\"name\":\"x\",\"scripts\":{\"build\":\"tsc\",\"start\":\"node dist/index.js\"}}"
            : p.endsWith(".ts") ? "export {};" : p === "README.md" ? "# x" : "{}",
        ])
      ),
      report: { summary: "ok", aggregations: {} },
    });
    const r = validateAggregationReportOutput(bad);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("devDependencies") || d.includes("typescript"))).toBe(true);
  });

  it("fails when package.json lacks scripts.build or scripts.start", () => {
    const bad = JSON.stringify({
      fileTree: AGGREGATION_REPORT_REQUIRED_FILES,
      files: Object.fromEntries(
        AGGREGATION_REPORT_REQUIRED_FILES.map((p) => [
          p,
          p === "package.json"
            ? "{\"name\":\"x\",\"devDependencies\":{\"typescript\":\"^5.0.0\"}}"
            : p.endsWith(".ts") ? "export {};" : p === "README.md" ? "# x" : "{}",
        ])
      ),
      report: { summary: "ok", aggregations: {} },
    });
    const r = validateAggregationReportOutput(bad);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("scripts"))).toBe(true);
  });

  it("fails when output is empty", () => {
    const r = validateAggregationReportOutput("");
    expect(r.pass).toBe(false);
    expect(r.defects.length).toBeGreaterThan(0);
  });
});

describe("validateStructuredAggregationArtifact", () => {
  it("passes for valid strict JSON with qualityScore >= 0.85", () => {
    const r = validateStructuredAggregationArtifact(VALID_STRICT_JSON);
    expect(r.pass).toBe(true);
    expect(r.defects).toHaveLength(0);
    expect(r.qualityScore).toBeGreaterThanOrEqual(0.85);
  });

  it("fails with qualityScore <= 0.4 when invalid", () => {
    const r = validateStructuredAggregationArtifact("not json");
    expect(r.pass).toBe(false);
    expect(r.defects.length).toBeGreaterThan(0);
    expect(r.qualityScore).toBeLessThanOrEqual(0.4);
  });

  it("fails when fileTree does not match files", () => {
    const bad = JSON.stringify({
      fileTree: ["a.ts"],
      files: { "a.ts": "x", "b.ts": "y" },
      report: { summary: "ok", aggregations: {} },
    });
    const r = validateStructuredAggregationArtifact(bad);
    expect(r.pass).toBe(false);
    expect(r.qualityScore).toBe(0.4);
  });

  it("fails when required file is missing", () => {
    const missing = JSON.stringify({
      fileTree: ["package.json"],
      files: { "package.json": "{}" },
      report: { summary: "ok", aggregations: {} },
    });
    const r = validateStructuredAggregationArtifact(missing);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("Required file missing"))).toBe(true);
  });

  it("fails when report.summary is missing", () => {
    const bad = JSON.stringify({
      fileTree: ["x.ts"],
      files: { "x.ts": "x" },
      report: { aggregations: {} },
    });
    const r = validateStructuredAggregationArtifact(bad);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("summary"))).toBe(true);
  });
});

describe("runOutputValidator", () => {
  it("returns null for unknown package id", () => {
    expect(runOutputValidator("unknown-package", "any")).toBeNull();
  });

  it("returns result for aggregation-report package id", () => {
    const r = runOutputValidator("aggregation-report", VALID_STRICT_JSON);
    expect(r).not.toBeNull();
    expect(r!.pass).toBe(true);
  });
});
