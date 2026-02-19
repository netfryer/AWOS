import { describe, it, expect } from "vitest";
import {
  validateAggregationReportOutput,
  runOutputValidator,
  AGGREGATION_REPORT_BANNED_PHRASES,
  AGGREGATION_REPORT_REQUIRED_KEYS,
} from "../outputValidators.js";

describe("validateAggregationReportOutput", () => {
  it("passes for valid stub output with summary and aggregations", () => {
    const valid = `
# Aggregation Report

## JSON Schema
\`\`\`json
{
  "summary": { "totalRows": 0, "aggregationCount": 2 },
  "aggregations": []
}
\`\`\`

## Implementation
Minimal Node/TS code would go here.
`;
    const r = validateAggregationReportOutput(valid);
    expect(r.pass).toBe(true);
    expect(r.defects).toHaveLength(0);
  });

  it("passes for bare JSON object with required keys", () => {
    const valid = 'Some text before\n{"summary":{"n":10},"aggregations":[{"name":"count","value":10}]}\nmore text';
    const r = validateAggregationReportOutput(valid);
    expect(r.pass).toBe(true);
    expect(r.defects).toHaveLength(0);
  });

  it("fails when output contains banned phrases", () => {
    for (const phrase of AGGREGATION_REPORT_BANNED_PHRASES) {
      const bad = `Let me show you. ${phrase} we have some data here.
\`\`\`json
{"summary":{},"aggregations":[]}
\`\`\``;
      const r = validateAggregationReportOutput(bad);
      expect(r.pass).toBe(false);
      expect(r.defects.some((d) => d.includes(phrase))).toBe(true);
    }
  });

  it("fails when JSON is invalid", () => {
    const invalidJson = "Not valid JSON: { summary: 1, aggregations";
    const r = validateAggregationReportOutput(invalidJson);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes("JSON") || d.includes("parseable"))).toBe(true);
  });

  it("fails when JSON object missing required key: summary", () => {
    const missing = '{"aggregations":[1,2,3]}';
    const r = validateAggregationReportOutput(missing);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes('"summary"'))).toBe(true);
  });

  it("fails when JSON object missing required key: aggregations", () => {
    const missing = '{"summary":{"total":0}}';
    const r = validateAggregationReportOutput(missing);
    expect(r.pass).toBe(false);
    expect(r.defects.some((d) => d.includes('"aggregations"'))).toBe(true);
  });

  it("fails when output is empty", () => {
    const r = validateAggregationReportOutput("");
    expect(r.pass).toBe(false);
    expect(r.defects.length).toBeGreaterThan(0);
  });
});

describe("runOutputValidator", () => {
  it("returns null for unknown package id", () => {
    expect(runOutputValidator("unknown-package", "any")).toBeNull();
  });

  it("returns result for aggregation-report package id", () => {
    const valid = '{"summary":{},"aggregations":[]}';
    const r = runOutputValidator("aggregation-report", valid);
    expect(r).not.toBeNull();
    expect(r!.pass).toBe(true);
  });
});
