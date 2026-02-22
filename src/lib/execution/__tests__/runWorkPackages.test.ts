import { describe, it, expect } from "vitest";
import { buildWorkerPrompt } from "../runWorkPackages.js";
import { AGGREGATION_REPORT_BANNED_PHRASES } from "../outputValidators.js";

describe("buildWorkerPrompt", () => {
  const basePkg = {
    id: "worker-1",
    name: "Test task",
    description: "A test",
    acceptanceCriteria: ["Criterion one", "Criterion two"],
  };

  it("includes task, description, and acceptance criteria", () => {
    const prompt = buildWorkerPrompt(basePkg);
    expect(prompt).toContain("Task: Test task");
    expect(prompt).toContain("Description: A test");
    expect(prompt).toContain("Acceptance criteria:");
    expect(prompt).toContain("1. Criterion one");
    expect(prompt).toContain("2. Criterion two");
  });

  it("includes Inputs section when pkg.inputs exists", () => {
    const pkg = {
      ...basePkg,
      inputs: {
        directive: "Build a CLI tool",
        strategyOutput: "from strategy",
      },
    };
    const prompt = buildWorkerPrompt(pkg);
    expect(prompt).toContain("Inputs:");
    expect(prompt).toContain("- directive: Build a CLI tool");
    expect(prompt).toContain("- strategyOutput: from strategy");
  });

  it("includes dependency output labels when dependencyArtifactsText is provided", () => {
    const depText = `--- strategy ---
Strategy output here.

--- worker-1 ---
Worker one output.`;
    const prompt = buildWorkerPrompt(basePkg, depText);
    expect(prompt).toContain("Dependency outputs to use:");
    expect(prompt).toContain("--- strategy ---");
    expect(prompt).toContain("Strategy output here.");
    expect(prompt).toContain("--- worker-1 ---");
    expect(prompt).toContain("Worker one output.");
  });

  it("adds aggregation-report instruction when id is aggregation-report and deps provided", () => {
    const pkg = { ...basePkg, id: "aggregation-report" };
    const prompt = buildWorkerPrompt(pkg, "--- worker-1 ---\nSome output");
    expect(prompt).toContain("Use the provided dependency outputs below");
    expect(prompt).toContain("Do not invent missing code");
  });

  it("aggregation-report prompt includes REPORT_JSON block requirement", () => {
    const pkg = { ...basePkg, id: "aggregation-report" };
    const prompt = buildWorkerPrompt(pkg);
    expect(prompt).toContain("REPORT_JSON:");
    expect(prompt).toContain("This block must be present and must contain the required keys");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"aggregations"');
  });

  it("aggregation-report constraints do not contain banned phrases outside the explicit forbidden list", () => {
    const pkg = { ...basePkg, id: "aggregation-report" };
    const prompt = buildWorkerPrompt(pkg);
    const forbiddenListStart = prompt.indexOf("Do not include these exact phrases anywhere");
    expect(forbiddenListStart).toBeGreaterThan(-1);
    const beforeForbiddenList = prompt.slice(0, forbiddenListStart).toLowerCase();
    for (const phrase of AGGREGATION_REPORT_BANNED_PHRASES) {
      expect(beforeForbiddenList).not.toContain(phrase.toLowerCase());
    }
  });

  it("preserves behavior for packages without inputs or deps", () => {
    const prompt = buildWorkerPrompt(basePkg);
    expect(prompt).not.toContain("Inputs:");
    expect(prompt).not.toContain("Dependency outputs to use:");
    expect(prompt).toContain("Produce your output artifact");
  });
});
