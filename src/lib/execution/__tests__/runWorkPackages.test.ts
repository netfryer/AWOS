import { describe, it, expect, vi } from "vitest";
import {
  buildWorkerPrompt,
  getMissingDependencyIds,
  AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC,
  runWorkPackages,
} from "../runWorkPackages.js";
import { AGGREGATION_REPORT_BANNED_PHRASES } from "../outputValidators.js";
import { runOutputValidator } from "../outputValidators.js";
import { route } from "../../../router.js";
import type { AtomicWorkPackage } from "../../planning/packageWork.js";
import type { ModelSpec } from "../../types.js";

vi.mock("../../model-hr/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../model-hr/index.js")>();
  return {
    ...actual,
    listEligibleModels: vi.fn().mockResolvedValue({ eligible: [] }),
    loadPriorsForModel: vi.fn().mockResolvedValue([]),
    recordObservation: vi.fn().mockResolvedValue(undefined),
  };
});

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

  it("aggregation-report prompt includes strict JSON schema requirement", () => {
    const pkg = { ...basePkg, id: "aggregation-report" };
    const prompt = buildWorkerPrompt(pkg);
    expect(prompt).toContain("fileTree");
    expect(prompt).toContain("files");
    expect(prompt).toContain("report");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"aggregations"');
    expect(prompt).toContain("Output only the JSON object");
    expect(prompt).toContain("Do not append selfConfidence");
  });

  it("aggregation-report prompt includes required files and package.json scripts", () => {
    const pkg = { ...basePkg, id: "aggregation-report" };
    const prompt = buildWorkerPrompt(pkg);
    expect(prompt).toContain("package.json");
    expect(prompt).toContain("tsconfig.json");
    expect(prompt).toContain("src/parser.ts");
    expect(prompt).toContain("src/stats.ts");
    expect(prompt).toContain("src/cli.ts");
    expect(prompt).toContain("src/index.ts");
    expect(prompt).toContain("README.md");
    expect(prompt).toContain('"build": "tsc"');
    expect(prompt).toContain('"start": "node dist/index.js"');
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

describe("getMissingDependencyIds", () => {
  it("returns empty when no dependencies", () => {
    const registry = { getArtifactByPackageId: () => undefined };
    expect(getMissingDependencyIds({ dependencies: [] }, registry)).toEqual([]);
  });

  it("returns dep IDs with missing artifacts", () => {
    const registry = {
      getArtifactByPackageId: (id: string) =>
        id === "worker-2" ? { content: "some output" } : undefined,
    };
    const missing = getMissingDependencyIds(
      { dependencies: ["worker-1", "worker-2", "worker-3"] },
      registry
    );
    expect(missing).toEqual(["worker-1", "worker-3"]);
  });

  it("returns dep IDs with empty or whitespace content", () => {
    const registry = {
      getArtifactByPackageId: (id: string) => {
        if (id === "worker-1") return { content: "" };
        if (id === "worker-2") return { content: "   " };
        if (id === "worker-3") return { content: "(missing artifact)" };
        return { content: "valid" };
      },
    };
    const missing = getMissingDependencyIds(
      { dependencies: ["worker-1", "worker-2", "worker-3", "worker-4"] },
      registry
    );
    expect(missing).toEqual(["worker-1", "worker-2", "worker-3"]);
  });
});

describe("aggregation-report missing dependency short-circuit", () => {
  it("AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC is valid strict JSON", () => {
    const parsed = JSON.parse(AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC);
    expect(parsed).toHaveProperty("fileTree", []);
    expect(parsed).toHaveProperty("files", {});
    expect(parsed).toHaveProperty("report");
    expect(parsed.report).toHaveProperty("summary", "Dependency artifacts missing");
    expect(parsed.report).toHaveProperty("aggregations", {});
  });

  it("runOutputValidator fails synthetic with defects naming missing required files", () => {
    const result = runOutputValidator("aggregation-report", AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC);
    expect(result).not.toBeNull();
    expect(result!.pass).toBe(false);
    expect(result!.defects.length).toBeGreaterThan(0);
    const defectStr = result!.defects.join(" ");
    expect(defectStr).toMatch(/Required file missing|fileTree|files/);
  });

  it("runWorkPackages short-circuits aggregation-report when dependency artifacts are empty", async () => {
    const packages: AtomicWorkPackage[] = [
      {
        id: "strategy",
        role: "Worker",
        name: "Strategy",
        description: "Plan",
        acceptanceCriteria: ["Plan A", "Plan B", "Plan C"],
        inputs: {},
        outputs: {},
        dependencies: [],
        estimatedTokens: 500,
      },
      {
        id: "worker-1",
        role: "Worker",
        name: "Worker 1",
        description: "Implement parser",
        acceptanceCriteria: ["Implement A", "Implement B", "Implement C"],
        inputs: {},
        outputs: {},
        dependencies: ["strategy"],
        estimatedTokens: 800,
      },
      {
        id: "worker-2",
        role: "Worker",
        name: "Worker 2",
        description: "Implement stats",
        acceptanceCriteria: ["Implement A", "Implement B", "Implement C"],
        inputs: {},
        outputs: {},
        dependencies: ["strategy"],
        estimatedTokens: 800,
      },
      {
        id: "worker-3",
        role: "Worker",
        name: "Worker 3",
        description: "Implement CLI",
        acceptanceCriteria: ["Implement A", "Implement B", "Implement C"],
        inputs: {},
        outputs: {},
        dependencies: ["strategy"],
        estimatedTokens: 800,
      },
      {
        id: "aggregation-report",
        role: "Worker",
        name: "Integration",
        description: "Integrate",
        acceptanceCriteria: ["Integrate A", "Integrate B", "Integrate C"],
        inputs: {},
        outputs: {},
        dependencies: ["worker-1", "worker-2", "worker-3"],
        estimatedTokens: 1500,
      },
    ];

    const model: ModelSpec = {
      id: "test-model",
      displayName: "Test",
      expertise: { code: 0.9, writing: 0.9, analysis: 0.9, general: 0.9 },
      pricing: { inPer1k: 0.0001, outPer1k: 0.0002 },
      reliability: 0.9,
    };

    const llmCalls: Array<{ modelId: string; packageId?: string }> = [];
    const ledgerDecisions: Array<{ type: string; packageId?: string; details?: unknown }> = [];

    const result = await runWorkPackages({
      packages,
      projectBudgetUSD: 10,
      tierProfile: "cheap",
      ctx: {
        route: (task, models) =>
          route(task, models, { thresholds: { low: 0.5, medium: 0.5, high: 0.5 } }),
        modelRegistry: [model],
        varianceStatsTracker: {
          getCalibration: async () => ({ nCost: 0, costMultiplier: null, nQuality: 0, qualityBias: null }),
          recordSubtaskVariance: async () => {},
        },
        trustTracker: {
          getTrust: () => 0.9,
          updateTrustWorker: () => {},
          updateTrustQa: () => {},
        } as import("../../governance/trustTracker.js").TrustTracker,
        llmTextExecute: async (modelId, _prompt) => {
          llmCalls.push({ modelId });
          return { text: "", usage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 } };
        },
        nowISO: () => new Date().toISOString(),
        runSessionId: "test-session",
        ledger: {
          createLedger: () => {},
          recordDecision: (_, r) => ledgerDecisions.push(r),
          recordCost: () => {},
          recordTrustDelta: () => {},
          getLedger: () => undefined,
          listLedgers: () => [],
        } as import("../../observability/runLedger.js").RunLedgerStore,
      },
    });

    const aggRun = result.runs.find((r) => r.packageId === "aggregation-report");
    expect(aggRun).toBeDefined();
    expect(aggRun!.output).toBe(AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC);

    const missingDepsWarning = result.warnings.find((w) =>
      w.includes("aggregation-report") && w.includes("dependency artifacts missing")
    );
    expect(missingDepsWarning).toBeDefined();
    expect(missingDepsWarning).toMatch(/worker-1|worker-2|worker-3/);

    const assemblyFailed = ledgerDecisions.find(
      (d) => d.type === "ASSEMBLY_FAILED" && d.packageId === "aggregation-report"
    );
    expect(assemblyFailed).toBeDefined();
    expect((assemblyFailed!.details as { missingDependencies?: string[] }).missingDependencies).toEqual([
      "worker-1",
      "worker-2",
      "worker-3",
    ]);

    const parsed = JSON.parse(aggRun!.output);
    expect(parsed.fileTree).toEqual([]);
    expect(parsed.files).toEqual({});
    expect(parsed.report.summary).toBe("Dependency artifacts missing");
  });
});

describe("roleExecutions RBEG telemetry", () => {
  const model: ModelSpec = {
    id: "test-model",
    displayName: "Test",
    expertise: { code: 0.9, writing: 0.9, analysis: 0.9, general: 0.9 },
    pricing: { inPer1k: 0.0001, outPer1k: 0.0002 },
    reliability: 0.9,
  };

  const baseCtx = {
    route: (task: { id: string }, models: ModelSpec[]) =>
      route(task, models, { thresholds: { low: 0.5, medium: 0.5, high: 0.5 } }),
    modelRegistry: [model],
    varianceStatsTracker: {
      getCalibration: async () => ({ nCost: 0, costMultiplier: null, nQuality: 0, qualityBias: null }),
      recordSubtaskVariance: async () => {},
    },
    trustTracker: {
      getTrust: () => 0.9,
      updateTrustWorker: () => {},
      updateTrustQa: () => {},
    } as import("../../governance/trustTracker.js").TrustTracker,
    nowISO: () => new Date().toISOString(),
    runSessionId: "test-session",
    ledger: {
      createLedger: () => {},
      recordDecision: () => {},
      recordCost: () => {},
      recordTrustDelta: () => {},
      recordVarianceRecorded: () => {},
      recordVarianceSkipped: () => {},
      getLedger: () => undefined,
      listLedgers: () => [],
    } as import("../../observability/runLedger.js").RunLedgerStore,
  };

  it("Worker status is fail when QA fails (pass: false)", async () => {
    const packages: AtomicWorkPackage[] = [
      {
        id: "worker-1",
        role: "Worker",
        name: "Worker 1",
        description: "Implement",
        acceptanceCriteria: ["A", "B", "C"],
        inputs: {},
        outputs: {},
        dependencies: [],
        estimatedTokens: 500,
      },
      {
        id: "qa-1",
        role: "QA",
        name: "QA 1",
        description: "Review worker-1",
        acceptanceCriteria: ["A", "B", "C"],
        inputs: {},
        outputs: { pass: true, qualityScore: 0.5, defects: [] },
        dependencies: ["worker-1"],
        estimatedTokens: 200,
      },
    ];

    const result = await runWorkPackages({
      packages,
      projectBudgetUSD: 10,
      tierProfile: "cheap",
      ctx: {
        ...baseCtx,
        llmTextExecute: async (_modelId, prompt) => {
          if (prompt.includes("QA reviewer")) {
            return {
              text: '{"pass":false,"qualityScore":0.35,"defects":["validation failed"]}',
              usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
            };
          }
          return {
            text: "worker output {\"selfConfidence\":0.8}",
            usage: { totalTokens: 50, inputTokens: 30, outputTokens: 20 },
          };
        },
      },
    });

    const workerExec = result.roleExecutions.find((e) => e.role === "worker" && e.nodeId === "worker-1");
    const qaExec = result.roleExecutions.find((e) => e.role === "qa" && e.nodeId === "qa-1");
    expect(workerExec).toBeDefined();
    expect(workerExec!.status).toBe("fail");
    expect(qaExec).toBeDefined();
    expect(qaExec!.status).toBe("fail");
  });

  it("Worker status is ok when QA passes", async () => {
    const packages: AtomicWorkPackage[] = [
      {
        id: "worker-1",
        role: "Worker",
        name: "Worker 1",
        description: "Implement",
        acceptanceCriteria: ["A", "B", "C"],
        inputs: {},
        outputs: {},
        dependencies: [],
        estimatedTokens: 500,
      },
      {
        id: "qa-1",
        role: "QA",
        name: "QA 1",
        description: "Review worker-1",
        acceptanceCriteria: ["A", "B", "C"],
        inputs: {},
        outputs: { pass: true, qualityScore: 0.5, defects: [] },
        dependencies: ["worker-1"],
        estimatedTokens: 200,
      },
    ];

    const result = await runWorkPackages({
      packages,
      projectBudgetUSD: 10,
      tierProfile: "cheap",
      ctx: {
        ...baseCtx,
        llmTextExecute: async (_modelId, prompt) => {
          if (prompt.includes("QA reviewer")) {
            return {
              text: '{"pass":true,"qualityScore":0.9,"defects":[]}',
              usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
            };
          }
          return {
            text: "worker output {\"selfConfidence\":0.8}",
            usage: { totalTokens: 50, inputTokens: 30, outputTokens: 20 },
          };
        },
      },
    });

    const workerExec = result.roleExecutions.find((e) => e.role === "worker" && e.nodeId === "worker-1");
    expect(workerExec).toBeDefined();
    expect(workerExec!.status).toBe("ok");
  });

  it("Worker score uses actualQuality (legacy) when no eval.overall", async () => {
    const packages: AtomicWorkPackage[] = [
      {
        id: "worker-1",
        role: "Worker",
        name: "Worker 1",
        description: "Implement",
        acceptanceCriteria: ["A", "B", "C"],
        inputs: {},
        outputs: {},
        dependencies: [],
        estimatedTokens: 500,
      },
      {
        id: "qa-1",
        role: "QA",
        name: "QA 1",
        description: "Review worker-1",
        acceptanceCriteria: ["A", "B", "C"],
        inputs: {},
        outputs: { pass: true, qualityScore: 0.5, defects: [] },
        dependencies: ["worker-1"],
        estimatedTokens: 200,
      },
    ];

    const result = await runWorkPackages({
      packages,
      projectBudgetUSD: 10,
      tierProfile: "cheap",
      ctx: {
        ...baseCtx,
        llmTextExecute: async (_modelId, prompt) => {
          if (prompt.includes("QA reviewer")) {
            return {
              text: '{"pass":true,"qualityScore":0.85,"defects":[]}',
              usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
            };
          }
          return {
            text: "worker output {\"selfConfidence\":0.8}",
            usage: { totalTokens: 50, inputTokens: 30, outputTokens: 20 },
          };
        },
      },
    });

    const workerExec = result.roleExecutions.find((e) => e.role === "worker" && e.nodeId === "worker-1");
    expect(workerExec).toBeDefined();
    expect(workerExec!.score).toBe(0.85);
  });
});
