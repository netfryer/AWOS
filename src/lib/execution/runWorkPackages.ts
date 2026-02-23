/**
 * Execution loop for AtomicWorkPackage[] with QA, variance/trust updates, escalation.
 * Supports concurrent execution with deterministic ready-queue scheduler and artifact registry.
 * Serialized state updates via TaskOutcome commit loop; QA fairness and deadlock detection.
 * Optional deterministic QA (shell) for implementation tasks before LLM QA.
 */

// ─── src/lib/execution/runWorkPackages.ts ───────────────────────────────────

import { spawn } from "child_process";
import type { AtomicWorkPackage, QaCheckShell } from "../planning/packageWork.js";
import { validateWorkPackages } from "../planning/packageWork.js";
import { trustWeightedScore } from "../governance/trustTracker.js";
import { evaluateEscalation, applyEscalationPolicy } from "../governance/escalationController.js";
import { extractFirstJsonValue } from "../llm/llmExecuteJson.js";
import type { ModelSpec, TaskCard, TaskType, Difficulty } from "../../types.js";
import type { TrustTracker } from "../governance/trustTracker.js";
import type { LlmTextExecuteResult } from "../llm/llmTextExecute.js";
import { InMemoryArtifactRegistry } from "./artifactRegistry.js";
import { runOutputValidator, AGGREGATION_REPORT_BANNED_PHRASES } from "./outputValidators.js";
import { assembleDeliverable, verifyAssemblyOutput, type AggregationArtifact } from "./assembleDeliverable.js";
import { isAllowedCommand } from "./qaAllowlist.js";
import type { RunLedgerStore } from "../observability/runLedger.js";
import type { PortfolioRecommendation } from "../governance/portfolioOptimizer.js";
import { getPortfolioMode } from "../governance/portfolioConfig.js";
import {
  listEligibleModels,
  computeModelScore,
  computeModelScoreWithBreakdown,
  loadPriorsForModel,
  computePredictedCostUSD,
  detectPricingMismatch,
  recordRegistryFallback,
} from "../model-hr/index.js";
import {
  getTenantConfig,
  filterRegistryEntriesForTenant,
  createEnvCredentialsResolver,
} from "../procurement/index.js";
import type { ModelScoreBreakdown } from "../model-hr/index.js";
import { mapRegistryEntryToModelSpec } from "../model-hr/index.js";
import { emitEscalationSignal } from "../model-hr/signals/signalLog.js";
import { recordObservationToModelHr } from "../governance/trustTracker.js";

export interface VarianceStatsTrackerLike {
  getCalibration(
    modelId: string,
    taskType: string
  ): Promise<{ nCost: number; costMultiplier: number | null; nQuality: number; qualityBias: number | null }>;
  recordSubtaskVariance(args: {
    modelId: string;
    taskType: string;
    estimatedCostUSD: number;
    actualCostUSD?: number;
    predictedQuality: number;
    actualQuality?: number;
  }): Promise<void>;
}

export type PortfolioMode = "prefer" | "lock" | "off";

export interface RunWorkPackagesContext {
  route: (
    task: TaskCard,
    models: ModelSpec[],
    config?: unknown,
    directive?: string,
    portfolioOptions?: { preferModelIds?: string[]; allowedModelIds?: string[] },
    routingOptions?: {
      candidateScores?: Map<string, number>;
      candidateScoreBreakdowns?: Map<string, ModelScoreBreakdown>;
      cheapestViableChosen?: boolean;
      priorsByModel?: Map<string, import("../model-hr/types.js").ModelPerformancePrior[]>;
    }
  ) => {
    chosenModelId: string | null;
    expectedCostUSD: number | null;
    estimatedTokens: { input: number; output: number };
    routingMeta?: { portfolioBypassed?: boolean; reason?: string };
    routingAudit?: {
      candidates: Array<{ modelId: string; predictedCostUSD: number; predictedQuality: number; passed: boolean; disqualifiedReason?: string; score?: number; scoreBreakdown?: ModelScoreBreakdown }>;
      enforceCheapestViable?: boolean;
      chosenIsCheapestViable?: boolean;
      rankedBy?: "score" | "cheapest_viable";
    };
  };
  modelRegistry: ModelSpec[];
  varianceStatsTracker: VarianceStatsTrackerLike;
  trustTracker: TrustTracker;
  llmTextExecute: (modelId: string, prompt: string) => Promise<LlmTextExecuteResult>;
  nowISO: () => string;
  onProgress?: (progress: { totalPackages: number; completedPackages: number; runningPackages: number; warnings: string[] }) => void;
  cwd?: string;
  runSessionId?: string;
  ledger?: RunLedgerStore;
  portfolioMode?: PortfolioMode;
  portfolio?: PortfolioRecommendation;
}

export interface RunWorkPackagesInput {
  packages: AtomicWorkPackage[];
  projectBudgetUSD: number;
  tierProfile: "cheap" | "standard" | "premium";
  ctx: RunWorkPackagesContext;
  concurrency?: { worker: number; qa: number };
  /** When true, enforce cheapest-viable selection (assertion mode; cheapest among passed) */
  cheapestViableChosen?: boolean;
}

export interface WorkerRun {
  packageId: string;
  modelId: string;
  output: string;
  predictedQuality: number;
  actualQuality?: number;
  predictedCostUSD: number;
  actualCostUSD: number;
  estimatedTokens: number;
  selfConfidence?: number;
  isEstimatedCost?: boolean;
  artifactId?: string;
  artifactHash?: string;
}

export interface QAResult {
  packageId: string;
  workerPackageId: string;
  pass: boolean;
  qualityScore: number;
  defects: string[];
  modelId: string;
}

export interface RunPackagesResult {
  runs: WorkerRun[];
  qaResults: QAResult[];
  escalations: Array<{ event: unknown; policy?: unknown }>;
  budget: { startingUSD: number; remainingUSD: number; escalationSpendUSD: number };
  warnings: string[];
}

const ESCALATION_SPEND_CAP_PCT = 0.1;
const ROUTING_CANDIDATES_CAP = 20;

/**
 * Build directive proxy for token estimation only.
 * Concatenates name, description, acceptance criteria, and inputs (e.g. directive, deliverables)
 * to approximate Worker prompt size. NOT used for the actual worker prompt.
 */
function buildWorkerDirectiveForTokenEstimate(pkg: {
  name: string;
  description?: string;
  acceptanceCriteria: string[];
  inputs?: Record<string, unknown>;
}): string {
  const parts: string[] = [`Task: ${pkg.name}`];
  if (pkg.description) parts.push(`Description: ${pkg.description}`);
  const criteria = (pkg.acceptanceCriteria ?? []).map((c, i) => `${i + 1}. ${c}`).join("\n");
  if (criteria) parts.push(`Acceptance criteria:\n${criteria}`);
  const inputs = pkg.inputs;
  if (inputs && typeof inputs === "object") {
    const directive = inputs.directive;
    const taskDesc = inputs.taskDescription;
    const deliverables = inputs.deliverables;
    if (typeof directive === "string") parts.push(`Directive: ${directive}`);
    if (typeof taskDesc === "string") parts.push(`Task: ${taskDesc}`);
    if (Array.isArray(deliverables)) {
      parts.push(`Deliverables: ${deliverables.map((d) => (typeof d === "string" ? d : JSON.stringify(d))).join(", ")}`);
    }
  }
  return parts.join("\n");
}

const DEPENDENCY_ARTIFACT_CAP_PER = 6_000;
const DEPENDENCY_ARTIFACT_CAP_TOTAL = 18_000;
const INPUT_VALUE_CAP = 2_000;

/** Format a single input value for prompt display; bounded and deterministic. */
function formatInputValue(val: unknown): string {
  if (val === null || val === undefined) return String(val);
  if (typeof val === "string") return val.length > INPUT_VALUE_CAP ? val.slice(0, INPUT_VALUE_CAP) + " (truncated)" : val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    const s = JSON.stringify(val);
    return s.length > INPUT_VALUE_CAP ? s.slice(0, INPUT_VALUE_CAP) + " (truncated)" : s;
  } catch {
    return String(val);
  }
}

/** Synthetic output when aggregation-report has missing dependency artifacts. Exported for tests. */
export const AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC = JSON.stringify({
  fileTree: [],
  files: {},
  report: { summary: "Dependency artifacts missing", aggregations: {} },
});

/** Returns dependency IDs with missing or empty artifacts. Never throws. Exported for tests. */
export function getMissingDependencyIds(
  pkg: { dependencies: string[] },
  registry: { getArtifactByPackageId(packageId: string): { content: string } | undefined }
): string[] {
  if (!pkg.dependencies?.length) return [];
  const missing: string[] = [];
  for (const depId of pkg.dependencies) {
    try {
      const artifact = registry.getArtifactByPackageId(depId);
      const content = artifact?.content ?? "";
      const trimmed = String(content).trim();
      if (trimmed.length === 0 || trimmed === "(missing artifact)") {
        missing.push(depId);
      }
    } catch {
      missing.push(depId);
    }
  }
  return missing;
}

/** Build dependency artifacts text from registry; never throws. Caps per-dep and total. */
function buildDependencyArtifactsText(
  pkg: { dependencies: string[] },
  registry: { getArtifactByPackageId(packageId: string): { content: string } | undefined }
): string {
  if (!pkg.dependencies?.length) return "";
  const sections: string[] = [];
  let totalChars = 0;
  for (const depId of pkg.dependencies) {
    if (totalChars >= DEPENDENCY_ARTIFACT_CAP_TOTAL) break;
    let content: string;
    try {
      const artifact = registry.getArtifactByPackageId(depId);
      content = artifact?.content ?? "(missing artifact)";
    } catch {
      content = "(missing artifact)";
    }
    const capped = content.length > DEPENDENCY_ARTIFACT_CAP_PER
      ? content.slice(0, DEPENDENCY_ARTIFACT_CAP_PER) + " (truncated)"
      : content;
    const remaining = DEPENDENCY_ARTIFACT_CAP_TOTAL - totalChars;
    const toAdd = capped.slice(0, remaining);
    if (toAdd.length > 0) {
      sections.push(`--- ${depId} ---\n${toAdd}`);
      totalChars += toAdd.length;
    }
  }
  return sections.length === 0 ? "" : sections.join("\n\n");
}

/**
 * Build the worker prompt from package metadata, optional inputs, and optional dependency outputs.
 * Pure helper; caller fetches artifacts and passes dependencyArtifactsText.
 */
export function buildWorkerPrompt(
  pkg: {
    id: string;
    name: string;
    description?: string;
    acceptanceCriteria: string[];
    inputs?: Record<string, unknown>;
  },
  dependencyArtifactsText?: string
): string {
  const acceptanceBlock = pkg.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const aggregationReportConstraints =
    pkg.id === "aggregation-report"
      ? `

CRITICAL: Output ONLY a single valid JSON object. No markdown. No code fences. No explanatory prose. No example or sample sections. No placeholder language. Do not wrap in backticks. Output only the JSON object, parseable by JSON.parse without modification.

Required schema (output this exact structure and nothing else):

{
  "fileTree": ["<path1>", "<path2>", ...],
  "files": {
    "<relative/path>": "<file contents>"
  },
  "report": {
    "summary": "<string>",
    "aggregations": <object>
  }
}

REQUIRED FILES (output MUST include exactly these paths in fileTree and files):
- package.json (must include scripts: "build": "tsc", "start": "node dist/index.js")
- tsconfig.json
- src/parser.ts
- src/stats.ts
- src/cli.ts
- src/index.ts
- README.md

Constraints:
- fileTree must list exactly every key in files (exact match).
- files must contain runnable Node/TypeScript source code. All content must be complete and non-placeholder.
- report must contain both required keys: summary and aggregations.
- Do not fabricate input datasets unless input data is explicitly provided.
- Do NOT include markdown fences or any text outside the JSON object.
- Do not include these exact phrases anywhere (even in negation): ${AGGREGATION_REPORT_BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}`
      : "";

  const useDependencyInstruction =
    pkg.id === "aggregation-report" && dependencyArtifactsText
      ? `

IMPORTANT: Use the provided dependency outputs below. Do not invent missing code or made-up content.`
      : "";

  const parts: string[] = [
    `Task: ${pkg.name}`,
    pkg.description ? `Description: ${pkg.description}` : "",
    "Acceptance criteria:",
    acceptanceBlock,
    aggregationReportConstraints,
    useDependencyInstruction,
  ].filter(Boolean);

  if (pkg.inputs && typeof pkg.inputs === "object" && Object.keys(pkg.inputs).length > 0) {
    const inputLines = Object.entries(pkg.inputs).map(
      ([k, v]) => `- ${k}: ${formatInputValue(v)}`
    );
    parts.push("Inputs:\n" + inputLines.join("\n"));
  }

  if (dependencyArtifactsText) {
    parts.push("Dependency outputs to use:\n" + dependencyArtifactsText);
  }

  const closingInstruction =
    pkg.id === "aggregation-report"
      ? "Output only the JSON object. Do not append selfConfidence or any other content."
      : "Produce your output artifact (text or JSON as appropriate). At the very end, append a single JSON line: {\"selfConfidence\":<0-1>}";
  parts.push(closingInstruction);

  return parts.join("\n\n");
}

const DEFAULT_WORKER_CONCURRENCY = 3;
const DEFAULT_QA_CONCURRENCY = 1;
const WORKER_QA_LEAD_LIMIT = 2;
const DETERMINISTIC_QA_TIMEOUT_MS = 90_000;
const DETERMINISTIC_QA_TAIL_CHARS = 2000;
const MIN_SAMPLES_FOR_QUALITY_BIAS = 5;

const DIFFICULTY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };

type RoutingCandidate = {
  modelId: string;
  predictedCostUSD: number;
  predictedQuality: number;
  passed: boolean;
  disqualifiedReason?: string;
  score?: number;
};

export interface CompBreakdown {
  predictedCostUSD: number;
  expectedCostUSD: number;
  costMultiplierUsed: number;
  inputsBreakdown: {
    inPer1k: number;
    outPer1k: number;
    inputTokens: number;
    outputTokens: number;
    rawCostUSD: number;
    costMultiplierUsed: number;
  };
}

type EnrichedRoutingCandidate = RoutingCandidate & {
  eligibilityReason?: string;
  status?: string;
  pricingExpectedCostUSD?: number;
  pricingMismatch?: boolean;
  compBreakdown?: CompBreakdown;
};

export interface PricingMismatchDetail {
  modelId: string;
  predictedCostUSD: number;
  pricingExpectedCostUSD: number;
  ratio: number;
}

function enrichRoutingCandidates(
  candidates: RoutingCandidate[],
  registryEntries?: Array<{ id: string; identity: { status: string } }>
): Array<EnrichedRoutingCandidate> {
  return candidates.map((c) => ({
    ...c,
    eligibilityReason: c.disqualifiedReason,
    status: registryEntries?.find((e) => e.id === c.modelId)?.identity?.status,
  }));
}

type RegistryEntryForEnrich = {
  id: string;
  pricing: { inPer1k: number; outPer1k: number };
  identity?: { status: string };
};

function buildProcurementFilteredCandidates(
  procurementFiltered: ProcurementFilteredEntry[] | undefined,
  estimatedTokens: { input: number; output: number },
  taskType: string,
  difficulty: string,
  tierProfile: "cheap" | "standard" | "premium"
): RoutingCandidate[] {
  if (!procurementFiltered || procurementFiltered.length === 0) return [];
  return procurementFiltered.map(({ entry, reason }) => {
    const comp = computePredictedCostUSD(
      entry,
      estimatedTokens,
      { taskType, difficulty, tierProfile },
      undefined
    );
    const predictedQuality = entry.expertise?.[taskType] ?? entry.expertise?.general ?? 0.7;
    return {
      modelId: entry.id,
      predictedCostUSD: comp.predictedCostUSD,
      predictedQuality,
      passed: false,
      disqualifiedReason: reason,
    };
  });
}

async function enrichRoutingCandidatesWithPricing(
  candidates: RoutingCandidate[],
  registryEntries: RegistryEntryForEnrich[] | undefined,
  estimatedTokens: { input: number; output: number },
  taskType: string,
  difficulty: string,
  tierProfile: "cheap" | "standard" | "premium"
): Promise<{
  candidates: Array<EnrichedRoutingCandidate>;
  pricingMismatchCount: number;
  pricingMismatches: PricingMismatchDetail[];
}> {
  const base = enrichRoutingCandidates(
    candidates,
    registryEntries as Array<{ id: string; identity: { status: string } }> | undefined
  );
  const pricingMismatches: PricingMismatchDetail[] = [];

  if (!registryEntries || registryEntries.length === 0) {
    return { candidates: base, pricingMismatchCount: 0, pricingMismatches };
  }

  const priorsByModel = new Map<string, import("../model-hr/types.js").ModelPerformancePrior[]>();
  const uniqueModelIds = [...new Set(candidates.map((c) => c.modelId))];
  await Promise.all(
    uniqueModelIds.map(async (modelId) => {
      try {
        const priors = await loadPriorsForModel(modelId);
        priorsByModel.set(modelId, priors);
      } catch {
        priorsByModel.set(modelId, []);
      }
    })
  );

  const enriched = base.map((c) => {
    const entry = registryEntries.find((e) => e.id === c.modelId);
    if (!entry) {
      return c;
    }
    const priors = priorsByModel.get(c.modelId) ?? [];
    const compCtx = { taskType, difficulty, tierProfile };
    const comp = computePredictedCostUSD(
      entry as import("../model-hr/types.js").ModelRegistryEntry,
      estimatedTokens,
      compCtx,
      priors.length > 0 ? priors : undefined
    );
    const compExpectedCostUSD = comp.predictedCostUSD;
    const routingCost = typeof c.predictedCostUSD === "number" ? c.predictedCostUSD : 0;
    const { mismatch, ratio } = detectPricingMismatch(routingCost, compExpectedCostUSD);
    const out: EnrichedRoutingCandidate = {
      ...c,
      pricingExpectedCostUSD: compExpectedCostUSD,
      pricingMismatch: mismatch,
      compBreakdown: {
        predictedCostUSD: comp.predictedCostUSD,
        expectedCostUSD: comp.expectedCostUSD,
        costMultiplierUsed: comp.costMultiplierUsed,
        inputsBreakdown: comp.inputsBreakdown,
      },
    };
    if (mismatch) {
      pricingMismatches.push({
        modelId: c.modelId,
        predictedCostUSD: routingCost,
        pricingExpectedCostUSD: compExpectedCostUSD,
        ratio,
      });
    }
    return out;
  });

  return {
    candidates: enriched,
    pricingMismatchCount: pricingMismatches.length,
    pricingMismatches,
  };
}

function runShellCheck(
  check: QaCheckShell,
  cwd: string
): Promise<{ exitCode: number; stdoutTail: string; stderrTail: string }> {
  return new Promise((resolve) => {
    if (!isAllowedCommand(check.command, check.args)) {
      resolve({
        exitCode: 1,
        stdoutTail: "",
        stderrTail: `Command not allowed: ${check.command} ${check.args.join(" ")}`,
      });
      return;
    }
    const proc = spawn(check.command, check.args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => { stdout += String(d); });
    proc.stderr?.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        exitCode: -1,
        stdoutTail: stdout.slice(-DETERMINISTIC_QA_TAIL_CHARS),
        stderrTail: (stderr + "\n[timeout]").slice(-DETERMINISTIC_QA_TAIL_CHARS),
      });
    }, DETERMINISTIC_QA_TIMEOUT_MS);
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? (signal ? -1 : 0),
        stdoutTail: stdout.slice(-DETERMINISTIC_QA_TAIL_CHARS),
        stderrTail: stderr.slice(-DETERMINISTIC_QA_TAIL_CHARS),
      });
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdoutTail: stdout.slice(-DETERMINISTIC_QA_TAIL_CHARS),
        stderrTail: stderr.slice(-DETERMINISTIC_QA_TAIL_CHARS),
      });
    });
  });
}

function isMissingScriptError(stderr: string, check: QaCheckShell): { skipped: true; scriptName: string } | { skipped: false } {
  const stderrLower = stderr.toLowerCase();
  if (!stderrLower.includes("missing script")) return { skipped: false };
  const args = check.args ?? [];
  if (args[0] === "test") return { skipped: true, scriptName: "test" };
  if (args[0] === "run" && args[1] === "lint") return { skipped: true, scriptName: "lint" };
  return { skipped: false };
}

async function runDeterministicQaChecks(
  checks: QaCheckShell[],
  cwd: string
): Promise<{ pass: boolean; qualityScore: number; defects: string[]; allChecksSkipped: boolean }> {
  const defects: string[] = [];
  let realFailureCount = 0;
  let skippedCount = 0;
  let passedCount = 0;

  for (const c of checks) {
    const r = await runShellCheck(c, cwd);
    if (r.exitCode !== 0) {
      const missing = isMissingScriptError(r.stderrTail, c);
      if (missing.skipped) {
        skippedCount++;
        const msg =
          missing.scriptName === "lint"
            ? "Skipped npm run lint: missing script 'lint'"
            : "Skipped npm test: missing script 'test'";
        defects.push(msg);
      } else {
        realFailureCount++;
        defects.push(`${c.name} failed (exit ${r.exitCode}): ${r.stderrTail.trim().slice(0, 500)}`);
      }
    } else {
      passedCount++;
    }
  }

  const pass = realFailureCount === 0;
  const allChecksSkipped = skippedCount > 0 && passedCount === 0 && realFailureCount === 0;
  let qualityScore: number;
  if (realFailureCount > 0) {
    qualityScore = 0.3;
  } else if (passedCount === 0 && skippedCount > 0) {
    qualityScore = 0.7;
  } else if (passedCount > 0 && skippedCount > 0) {
    qualityScore = 0.85;
  } else {
    qualityScore = 1.0;
  }

  return {
    pass,
    qualityScore,
    defects,
    allChecksSkipped,
  };
}

function inferTaskType(pkg: AtomicWorkPackage): TaskType {
  const name = (pkg.name + " " + (pkg.description ?? "")).toLowerCase();
  if (/\b(implement|code|build|create|develop|write)\b/.test(name)) return "code";
  if (/\b(research|analyze|investigate|explore)\b/.test(name)) return "analysis";
  if (/\b(review|audit|verify|check|validate)\b/.test(name)) return "writing";
  return "general";
}

function inferDifficulty(pkg: AtomicWorkPackage): Difficulty {
  const desc = pkg.description ?? pkg.name;
  const len = desc.length;
  if (/\b(complex|critical|comprehensive|advanced)\b/i.test(desc) || len > 200) return "high";
  if (/\b(simple|quick|basic|minor)\b/i.test(desc) || len < 50) return "low";
  return "medium";
}

function getPortfolioOptionsForWorker(
  portfolio: PortfolioRecommendation,
  taskType: TaskType,
  mode: "prefer" | "lock"
): { preferModelIds: string[]; allowedModelIds?: string[] } {
  const workerSlot =
    taskType === "code"
      ? portfolio.portfolio.workerImplementation
      : taskType === "analysis"
        ? portfolio.portfolio.workerStrategy
        : portfolio.portfolio.workerCheap;
  const preferModelIds = [workerSlot].filter(Boolean);
  const allowedModelIds = mode === "lock" ? preferModelIds : undefined;
  return { preferModelIds, allowedModelIds };
}

function getPortfolioOptionsForQa(
  portfolio: PortfolioRecommendation,
  mode: "prefer" | "lock"
): { preferModelIds: string[]; allowedModelIds?: string[] } {
  const preferModelIds = [
    portfolio.portfolio.qaPrimary,
    portfolio.portfolio.qaBackup,
  ].filter(Boolean);
  const allowedModelIds = mode === "lock" ? preferModelIds : undefined;
  return { preferModelIds, allowedModelIds };
}

function filterModelsByTier(
  models: ModelSpec[],
  tier: "cheap" | "standard" | "premium"
): ModelSpec[] {
  if (tier === "standard") return models;
  const withCost = models.map((m) => ({
    m,
    cost: m.pricing.inPer1k + m.pricing.outPer1k,
  }));
  withCost.sort((a, b) => a.cost - b.cost);
  const n = models.length;
  if (tier === "cheap") {
    const take = Math.max(1, Math.floor(n * 0.5));
    return withCost.slice(0, take).map((x) => x.m);
  }
  const take = Math.max(1, Math.floor(n * 0.5));
  return withCost.slice(-take).map((x) => x.m);
}

type ProcurementFilteredEntry = {
  entry: import("../model-hr/types.js").ModelRegistryEntry;
  reason: import("../procurement/types.js").ProcurementFilterReason;
};

async function resolveModelsForRouting(
  tierProfile: "cheap" | "standard" | "premium",
  budgetRemainingUSD: number,
  taskType: string,
  difficulty: string,
  importance: number | undefined,
  fallbackModels: ModelSpec[],
  ledger: RunLedgerStore | undefined,
  runSessionId: string | undefined,
  tierUnion?: ("cheap" | "standard" | "premium")[]
): Promise<{
  models: ModelSpec[];
  registryEntries?: import("../model-hr/types.js").ModelRegistryEntry[];
  usedFallback: boolean;
  procurementFallback?: boolean;
  procurementFiltered?: ProcurementFilteredEntry[];
}> {
  let registryError: string | undefined;
  const tiersToResolve = tierUnion ?? [tierProfile];
  const fallbackTier = tierUnion && tierUnion.length > 1 ? "standard" : tierProfile;
  try {
    const seenIds = new Set<string>();
    const eligible: import("../model-hr/types.js").ModelRegistryEntry[] = [];
    for (const t of tiersToResolve) {
      const { eligible: e } = await listEligibleModels({
        tierProfile: t,
        taskType,
        difficulty,
        budgetRemainingUSD,
        importance,
      });
      for (const m of e) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          eligible.push(m);
        }
      }
    }
    if (eligible.length > 0) {
      const config = await getTenantConfig("default");
      const credentials = createEnvCredentialsResolver();
      const { allowed, filtered } = filterRegistryEntriesForTenant(
        eligible,
        config,
        credentials
      );
      if (allowed.length > 0) {
        return {
          models: allowed.map(mapRegistryEntryToModelSpec),
          registryEntries: allowed,
          usedFallback: false,
          procurementFiltered:
            filtered.length > 0
              ? filtered.map((f) => ({ entry: f.entry, reason: f.reason }))
              : undefined,
        };
      }
      recordRegistryFallback("procurement_no_eligible_models");
      const models = filterModelsByTier(fallbackModels, fallbackTier);
      if (ledger && runSessionId) {
        ledger.recordDecision(runSessionId, {
          type: "PROCUREMENT_FALLBACK",
          packageId: "routing",
          details: {
            procurementFallback: true,
            reason: "procurement_no_eligible_models",
            fallbackModelCount: models.length,
            filteredCount: filtered.length,
          },
        });
      }
      return {
        models,
        usedFallback: true,
        procurementFallback: true,
        procurementFiltered: filtered.map((f) => ({ entry: f.entry, reason: f.reason })),
      };
    }
    registryError = "registry_empty";
  } catch (e) {
    registryError = e instanceof Error ? e.message : String(e);
  }
  recordRegistryFallback(registryError);
  const models = filterModelsByTier(fallbackModels, fallbackTier);
  if (ledger && runSessionId) {
    ledger.recordDecision(runSessionId, {
      type: "BUDGET_OPTIMIZATION",
      packageId: "routing",
      details: {
        modelHrFallback: true,
        reason: "model_hr_registry_unavailable",
        fallbackModelCount: models.length,
        ...(registryError && { errorSummary: registryError }),
      },
    });
  }
  return { models, usedFallback: true };
}

async function computeCandidateScores(
  registryEntries: import("../model-hr/types.js").ModelRegistryEntry[],
  taskType: string,
  difficulty: string,
  tierProfile: "cheap" | "standard" | "premium",
  budgetRemaining: number
): Promise<Map<string, number>> {
  const { scores } = await computeCandidateScoresWithBreakdown(
    registryEntries,
    taskType,
    difficulty,
    tierProfile,
    budgetRemaining
  );
  return scores;
}

async function computeCandidateScoresWithBreakdown(
  registryEntries: import("../model-hr/types.js").ModelRegistryEntry[],
  taskType: string,
  difficulty: string,
  tierProfile: "cheap" | "standard" | "premium",
  budgetRemaining: number
): Promise<{ scores: Map<string, number>; breakdowns: Map<string, ModelScoreBreakdown> }> {
  const scores = new Map<string, number>();
  const breakdowns = new Map<string, ModelScoreBreakdown>();
  const ctx = { taskType, difficulty, tierProfile, budgetRemaining };
  await Promise.all(
    registryEntries.map(async (entry) => {
      const { score, breakdown } = await computeModelScoreWithBreakdown(entry, ctx);
      scores.set(entry.id, score);
      breakdowns.set(entry.id, breakdown);
    })
  );
  return { scores, breakdowns };
}

function computeCost(
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens / 1000) * model.pricing.inPer1k +
    (outputTokens / 1000) * model.pricing.outPer1k
  );
}

function computeCostFromTotal(model: ModelSpec, totalTokens: number): number {
  const inputTokens = Math.round(totalTokens * 0.6);
  const outputTokens = totalTokens - inputTokens;
  return computeCost(model, inputTokens, outputTokens);
}

type RoutingResult = {
  chosenModelId: string | null;
  expectedCostUSD: number | null;
  routingAudit?: { candidates: Array<{ modelId: string; predictedCostUSD: number }> };
};

function getChosenPredictedCostUSD(
  routing: RoutingResult,
  chosenModelId: string,
  pkgEstimatedTokens: number,
  model: ModelSpec | undefined
): number {
  const chosen = routing.routingAudit?.candidates?.find((c) => c.modelId === chosenModelId);
  if (chosen != null && typeof chosen.predictedCostUSD === "number" && chosen.predictedCostUSD > 0) {
    return chosen.predictedCostUSD;
  }
  if (routing.expectedCostUSD != null && routing.expectedCostUSD > 0) {
    return routing.expectedCostUSD;
  }
  if (model) {
    return computeCostFromTotal(model, pkgEstimatedTokens);
  }
  return (pkgEstimatedTokens / 1000) * 0.01;
}

function validateQALinkage(packages: AtomicWorkPackage[]): void {
  const workerIds = new Set(
    packages.filter((p) => p.role === "Worker").map((p) => p.id)
  );
  for (const pkg of packages) {
    if (pkg.role !== "QA") continue;
    if (pkg.dependencies.length !== 1) {
      throw new Error(
        `[runWorkPackages] QA package "${pkg.id}" must have exactly 1 dependency, got ${pkg.dependencies.length}`
      );
    }
    const depId = pkg.dependencies[0];
    if (!workerIds.has(depId)) {
      throw new Error(
        `[runWorkPackages] QA package "${pkg.id}" dependency "${depId}" is not a Worker package`
      );
    }
  }
}

function parseQaOutput(text: string): { pass: boolean; qualityScore: number; defects: string[] } {
  const extracted = extractFirstJsonValue(text);
  const parsed = JSON.parse(extracted) as Record<string, unknown>;
  const pass = Boolean(parsed.pass);
  const qualityScore = typeof parsed.qualityScore === "number"
    ? Math.max(0, Math.min(1, parsed.qualityScore))
    : 0.5;
  const defects = Array.isArray(parsed.defects)
    ? parsed.defects.filter((d): d is string => typeof d === "string")
    : [];
  return { pass, qualityScore, defects };
}

function buildIndegree(packages: AtomicWorkPackage[]): Map<string, number> {
  const indegree = new Map<string, number>();
  for (const p of packages) {
    indegree.set(p.id, p.dependencies.length);
  }
  return indegree;
}

function buildDownstreamCount(packages: AtomicWorkPackage[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const p of packages) {
    count.set(p.id, 0);
  }
  for (const p of packages) {
    for (const dep of p.dependencies) {
      count.set(dep, (count.get(dep) ?? 0) + 1);
    }
  }
  return count;
}

function packagePriority(
  pkg: AtomicWorkPackage,
  downstreamCount: Map<string, number>,
  importance: number,
  difficulty: Difficulty
): [number, number, number, string] {
  const imp = importance;
  const diff = DIFFICULTY_ORDER[difficulty] ?? 2;
  const down = downstreamCount.get(pkg.id) ?? 0;
  return [-imp, -diff, -down, pkg.id];
}

interface WorkerTaskOutcome {
  type: "worker";
  packageId: string;
  run: WorkerRun;
  actualCostUSD: number;
  pkg: AtomicWorkPackage;
}

interface QATaskOutcome {
  type: "qa";
  packageId: string;
  workerPackageId: string;
  qaParsed: { pass: boolean; qualityScore: number; defects: string[] };
  qaCostUSD: number;
  modelId: string;
  pkg: AtomicWorkPackage;
  /** When deterministic QA ran (shell checks) */
  deterministicRan?: boolean;
  /** Pass result from deterministic run; only set when deterministicRan and LLM also ran */
  deterministicPass?: boolean;
  /** For Model HR: predicted cost/quality when LLM QA ran */
  qaPredictedCostUSD?: number;
  qaPredictedQuality?: number;
  /** Deterministic ran but all checks skipped (no signal) */
  deterministicNoSignal?: boolean;
  /** LLM QA skipped due to budget gating */
  budgetGated?: boolean;
  /** QA mode: deterministic-only, llm-only, or hybrid */
  qaMode?: "deterministic" | "llm" | "hybrid";
}

type TaskOutcome = WorkerTaskOutcome | QATaskOutcome;

export async function runWorkPackages(
  input: RunWorkPackagesInput
): Promise<RunPackagesResult> {
  const { packages, projectBudgetUSD, tierProfile, ctx, cheapestViableChosen: enforceCheapestViable } = input;
  const portfolioMode = ctx.portfolioMode ?? getPortfolioMode();
  const workerConcurrency = input.concurrency?.worker ?? DEFAULT_WORKER_CONCURRENCY;
  const qaConcurrency = input.concurrency?.qa ?? DEFAULT_QA_CONCURRENCY;

  validateWorkPackages(packages);
  validateQALinkage(packages);

  const idToPkg = new Map(packages.map((p) => [p.id, p]));
  const indegree = buildIndegree(packages);
  const downstreamCount = buildDownstreamCount(packages);
  const dependents = new Map<string, string[]>();
  for (const p of packages) {
    for (const dep of p.dependencies) {
      const list = dependents.get(dep) ?? [];
      list.push(p.id);
      dependents.set(dep, list);
    }
  }

  const runs: WorkerRun[] = [];
  const qaResults: QAResult[] = [];
  const escalations: RunPackagesResult["escalations"] = [];
  const warnings: string[] = [];
  let remainingUSD = projectBudgetUSD;
  let currentTier = tierProfile;
  let escalationSpendUSD = 0;
  const escalationSpendCapUSD = ESCALATION_SPEND_CAP_PCT * projectBudgetUSD;

  const workerRuns = new Map<string, WorkerRun>();
  const registry = new InMemoryArtifactRegistry();

  const readyWorkers: AtomicWorkPackage[] = [];
  const readyQA: AtomicWorkPackage[] = [];
  for (const p of packages) {
    if (indegree.get(p.id) === 0) {
      if (p.role === "Worker") readyWorkers.push(p);
      else readyQA.push(p);
    }
  }

  const completed = new Set<string>();
  let workerCompletedCount = 0;
  let qaCompletedCount = 0;

  function notifyProgress(running: number): void {
    ctx.onProgress?.({
      totalPackages: packages.length,
      completedPackages: completed.size,
      runningPackages: running,
      warnings: [...warnings],
    });
  }

  function commitOutcomes(outcomes: TaskOutcome[]): void {
    const sorted = [...outcomes].sort((a, b) => a.packageId.localeCompare(b.packageId));
    for (const o of sorted) {
      if (o.type === "worker") {
        remainingUSD -= o.actualCostUSD;
        if (ctx.runSessionId && ctx.ledger) {
          ctx.ledger.recordCost(ctx.runSessionId, "worker", o.actualCostUSD);
        }
        runs.push(o.run);
        workerRuns.set(o.pkg.id, o.run);
        completed.add(o.pkg.id);
        workerCompletedCount++;
        for (const depId of dependents.get(o.pkg.id) ?? []) {
          const prev = indegree.get(depId) ?? 1;
          const next = prev - 1;
          indegree.set(depId, next);
          if (next === 0) {
            const depPkg = idToPkg.get(depId);
            if (depPkg) {
              if (depPkg.role === "QA") readyQA.push(depPkg);
              else readyWorkers.push(depPkg);
            }
          }
        }
      } else {
        remainingUSD -= o.qaCostUSD;
        if (ctx.runSessionId && ctx.ledger) {
          if (o.modelId === "deterministic") {
            ctx.ledger.recordCost(ctx.runSessionId, "deterministicQa", 0);
          } else {
            ctx.ledger.recordCost(ctx.runSessionId, "qa", o.qaCostUSD);
          }
        }
        const workerRun = workerRuns.get(o.workerPackageId);
        const workerPkg = idToPkg.get(o.workerPackageId);
        if (workerRun) {
          workerRun.actualQuality = o.qaParsed.qualityScore;
          qaResults.push({
            packageId: o.packageId,
            workerPackageId: o.workerPackageId,
            pass: o.qaParsed.pass,
            qualityScore: o.qaParsed.qualityScore,
            defects: o.qaParsed.defects,
            modelId: o.modelId,
          });

          const costVarianceRatio = workerRun.predictedCostUSD > 0 ? workerRun.actualCostUSD / workerRun.predictedCostUSD : 1;
          const qaTrustAtTime = o.modelId !== "deterministic" ? ctx.trustTracker.getTrust(o.modelId, "qa") : 1;
          const nowISO = ctx.nowISO();
          const workerTrustBefore = ctx.trustTracker.getTrust(workerRun.modelId, "worker");
          ctx.trustTracker.updateTrustWorker(
            workerRun.modelId,
            workerRun.predictedQuality,
            o.qaParsed.qualityScore,
            o.qaParsed.pass,
            costVarianceRatio,
            nowISO
          );
          if (ctx.runSessionId && ctx.ledger) {
            const workerTrustAfter = ctx.trustTracker.getTrust(workerRun.modelId, "worker");
            ctx.ledger.recordTrustDelta(ctx.runSessionId, workerRun.modelId, "worker", workerTrustBefore, workerTrustAfter);
          }

          if (
            o.deterministicRan &&
            o.deterministicPass !== undefined &&
            o.modelId !== "deterministic"
          ) {
            const llmPass = o.qaParsed.pass;
            const llmQuality = o.qaParsed.qualityScore;
            const agreed =
              o.deterministicPass === llmPass &&
              (o.deterministicPass ? llmQuality >= 0.7 : llmQuality <= 0.6);
            const qaTrustBefore = ctx.trustTracker.getTrust(o.modelId, "qa");
            ctx.trustTracker.updateTrustQa(o.modelId, agreed, undefined, nowISO);
            if (ctx.runSessionId && ctx.ledger) {
              const qaTrustAfter = ctx.trustTracker.getTrust(o.modelId, "qa");
              ctx.ledger.recordTrustDelta(ctx.runSessionId, o.modelId, "qa", qaTrustBefore, qaTrustAfter);
            }
          }
          if (
            o.modelId !== "deterministic" &&
            typeof o.qaPredictedCostUSD === "number" &&
            typeof o.qaPredictedQuality === "number"
          ) {
            const defects = o.qaParsed.defects ?? [];
            recordObservationToModelHr({
              modelId: o.modelId,
              taskType: "analysis",
              difficulty: "medium",
              actualCostUSD: o.qaCostUSD,
              predictedCostUSD: o.qaPredictedCostUSD,
              actualQuality: o.qaParsed.qualityScore,
              predictedQuality: o.qaPredictedQuality,
              tsISO: nowISO,
              ...(ctx.runSessionId && { runSessionId: ctx.runSessionId }),
              packageId: o.packageId,
              ...(defects.length > 0 && {
                defectCount: defects.length,
                defectSamples: defects.slice(0, 5).map((d) => d.slice(0, 200)),
              }),
              ...(o.qaMode && { qaMode: o.qaMode }),
              ...(o.deterministicNoSignal && { deterministicNoSignal: true }),
              ...(o.budgetGated && { budgetGated: true }),
            }).catch(() => {});
          }

          if (!workerRun.isEstimatedCost) {
            const workerTaskType = workerPkg ? inferTaskType(workerPkg) : "general";
            const actualQualityForVariance = o.deterministicRan
              ? (o.deterministicPass !== undefined ? (o.deterministicPass ? 1.0 : 0.3) : o.qaParsed.qualityScore)
              : o.qaParsed.qualityScore;
            const deterministicOnly = o.deterministicRan && o.deterministicPass === undefined;
            const deterministicAndLlm = o.deterministicRan && o.deterministicPass !== undefined;
            const llmOnly = !o.deterministicRan;
            const shouldRecord =
              deterministicOnly ||
              deterministicAndLlm ||
              (llmOnly && qaTrustAtTime >= 0.45);
            if (ctx.runSessionId && ctx.ledger) {
              if (shouldRecord) {
                ctx.ledger.recordVarianceRecorded(ctx.runSessionId);
              } else {
                ctx.ledger.recordVarianceSkipped(ctx.runSessionId, "qa_trust_low");
              }
            }
            if (shouldRecord) {
              ctx.varianceStatsTracker.recordSubtaskVariance({
                modelId: workerRun.modelId,
                taskType: workerTaskType,
                estimatedCostUSD: workerRun.predictedCostUSD,
                actualCostUSD: workerRun.actualCostUSD,
                predictedQuality: workerRun.predictedQuality,
                actualQuality: actualQualityForVariance,
              });
            }
            if (workerRun.modelId !== "deterministic") {
              const workerDifficulty = workerPkg ? inferDifficulty(workerPkg) : "medium";
              const defects = o.qaParsed.defects ?? [];
              recordObservationToModelHr({
                modelId: workerRun.modelId,
                taskType: workerTaskType,
                difficulty: workerDifficulty,
                actualCostUSD: workerRun.actualCostUSD,
                predictedCostUSD: workerRun.predictedCostUSD,
                actualQuality: actualQualityForVariance,
                predictedQuality: workerRun.predictedQuality,
                tsISO: nowISO,
                ...(ctx.runSessionId && { runSessionId: ctx.runSessionId }),
                ...(o.workerPackageId && { packageId: o.workerPackageId }),
                ...(defects.length > 0 && {
                  defectCount: defects.length,
                  defectSamples: defects.slice(0, 5).map((d) => d.slice(0, 200)),
                }),
                ...(o.qaMode && { qaMode: o.qaMode }),
                ...(o.deterministicNoSignal && { deterministicNoSignal: true }),
                ...(o.budgetGated && { budgetGated: true }),
              }).catch(() => {});
            }
          }

          const subtaskImportance = workerPkg?.importance ?? o.pkg?.importance ?? 3;
          const evts = evaluateEscalation({
            subtaskImportance,
            qaPass: o.qaParsed.pass,
            actualQuality: o.qaParsed.qualityScore,
            predictedQuality: workerRun.predictedQuality,
            actualCostUSD: workerRun.actualCostUSD,
            predictedCostUSD: workerRun.predictedCostUSD,
            modelTrust: ctx.trustTracker.getTrust(workerRun.modelId, "worker"),
            modelId: workerRun.modelId,
          });

          for (const evt of evts) {
            escalations.push({ event: evt });
            const policy = applyEscalationPolicy(currentTier, evt);
            if (ctx.runSessionId && ctx.ledger) {
              ctx.ledger.recordDecision(ctx.runSessionId, {
                type: "ESCALATION",
                packageId: o.workerPackageId,
                details: {
                  reason: (evt as { reason?: string }).reason,
                  action: (evt as { action?: string }).action,
                  newTier: policy.newTier,
                  switchedModel: (evt as { context?: { modelId?: string } }).context?.modelId,
                },
              });
            }
            const modelId = workerRun.modelId;
            if (modelId) {
              const evtReason = (evt as { reason?: string }).reason;
              const rec = (evt as { context?: { recommendedAction?: string } }).context?.recommendedAction;
              let signalReason: string;
              if (rec === "SWITCH_MODEL") signalReason = "escalation_switch_model";
              else if (evtReason === "budget_exceeded") signalReason = "escalation_budget_exceeded";
              else if (evtReason === "quality_threshold") signalReason = "escalation_quality_drop";
              else signalReason = "escalation_other";
              try {
                emitEscalationSignal(modelId, signalReason, {
                  packageId: o.workerPackageId,
                  runSessionId: ctx.runSessionId ?? undefined,
                  escalationReason: evtReason,
                });
              } catch {
                /* never fail run */
              }
            }
            const rec = (evt as { context?: { recommendedAction?: string } }).context?.recommendedAction;
            if (rec === "RETRY_UPGRADE_TIER") {
              const rerunCost = workerRun.predictedCostUSD * 1.2;
              if (escalationSpendUSD + rerunCost > escalationSpendCapUSD) {
                warnings.push(
                  `Skipped rerun: would exceed escalation spend cap (cap $${escalationSpendCapUSD.toFixed(4)}, would spend $${(escalationSpendUSD + rerunCost).toFixed(4)})`
                );
              }
            }
            if (policy.newTier !== currentTier && policy.newTier) {
              currentTier = policy.newTier;
            }
          }
        }
        completed.add(o.packageId);
        qaCompletedCount++;
        for (const depId of dependents.get(o.packageId) ?? []) {
          const prev = indegree.get(depId) ?? 1;
          const next = prev - 1;
          indegree.set(depId, next);
          if (next === 0) {
            const depPkg = idToPkg.get(depId);
            if (depPkg) {
              if (depPkg.role === "QA") readyQA.push(depPkg);
              else readyWorkers.push(depPkg);
            }
          }
        }
      }
    }
  }

  while (readyWorkers.length > 0 || readyQA.length > 0) {
    const workerTierForResolve =
      readyWorkers.some((p) => p.tierProfileOverride != null) ? "standard" : currentTier;
    const workerTierUnion =
      readyWorkers.some((p) => p.tierProfileOverride != null)
        ? [...new Set(readyWorkers.map((p) => p.tierProfileOverride ?? currentTier))]
        : undefined;
    const {
      models: modelsByTier,
      registryEntries: workerRegistryEntries,
      usedFallback: modelsUsedFallback,
      procurementFallback: modelsProcurementFallback,
      procurementFiltered: workerProcurementFiltered,
    } = await resolveModelsForRouting(
      workerTierForResolve,
      remainingUSD,
      "general",
      "low",
      3,
      ctx.modelRegistry,
      ctx.ledger,
      ctx.runSessionId,
      workerTierUnion
    );

    const workerLead = workerCompletedCount - qaCompletedCount;
    const qaBacklogExists = readyQA.length > 0;
    const canRunWorkers =
      workerLead < WORKER_QA_LEAD_LIMIT ||
      !qaBacklogExists; /* allow workers when no QA is waiting (e.g. aggregation before qa-review) */

    if (readyQA.length > 0 && remainingUSD > 0) {
      readyQA.sort((a, b) => {
        const pa = packagePriority(a, downstreamCount, 3, inferDifficulty(a));
        const pb = packagePriority(b, downstreamCount, 3, inferDifficulty(b));
        for (let i = 0; i < 4; i++) {
          if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
        }
        return 0;
      });

      const qaBatch = readyQA.splice(0, qaConcurrency);
      const cwd = ctx.cwd ?? process.cwd();

      const {
        models: qaModels,
        registryEntries: qaRegistryEntries,
        usedFallback: qaModelsUsedFallback,
        procurementFallback: qaProcurementFallback,
        procurementFiltered: qaProcurementFiltered,
      } = await resolveModelsForRouting(
        currentTier,
        remainingUSD,
        "analysis",
        "medium",
        3,
        ctx.modelRegistry,
        ctx.ledger,
        ctx.runSessionId
      );

      const qaPromises = qaBatch.map(async (pkg) => {
        const workerId = pkg.dependencies[0];
        const excerpt = registry.getArtifactExcerptByPackageId(workerId);
        const workerOutputBlock =
          excerpt.totalLength > 0
            ? excerpt.head + (excerpt.tail ? `\n\n[... ${excerpt.totalLength - excerpt.head.length - excerpt.tail.length} chars omitted ...]\n\n` + excerpt.tail : "")
            : "";
        const workerRun = workerRuns.get(workerId);
        const workerPkg = idToPkg.get(workerId);

        if (!workerRun) {
          return { outcome: null as TaskOutcome | null, warning: `QA ${pkg.id}: missing worker run for ${workerId}` };
        }

        const importance = workerPkg?.importance ?? 3;
        const qaChecks = workerPkg?.qaChecks?.filter((c): c is QaCheckShell => c.type === "shell");
        const fullWorkerOutput =
          (registry.getArtifactByPackageId(workerId)?.content as string | undefined) ?? "";
        const outputValidation = runOutputValidator(workerId, fullWorkerOutput);

        let qaParsed: { pass: boolean; qualityScore: number; defects: string[]; allChecksSkipped?: boolean };
        let qaCostUSD = 0;
        let modelId = "deterministic";
        let deterministicRan = false;
        let deterministicPassForOutcome: boolean | undefined;
        let qaPredictedCostUSD: number | undefined;
        let qaPredictedQuality: number | undefined;
        let deterministicNoSignalForOutcome = false;
        let budgetGatedForOutcome = false;
        let qaModeForOutcome: "deterministic" | "llm" | "hybrid" = "llm";

        if (qaChecks && qaChecks.length > 0) {
          qaParsed = await runDeterministicQaChecks(qaChecks, cwd);
          if (outputValidation && !outputValidation.pass) {
            qaParsed = {
              pass: false,
              qualityScore: 0.3,
              defects: [...qaParsed.defects, ...outputValidation.defects],
              allChecksSkipped: qaParsed.allChecksSkipped,
            };
          }
          deterministicRan = true;
          deterministicNoSignalForOutcome = qaParsed.allChecksSkipped === true;
          const deterministicPass = qaParsed.pass;
          const deterministicNoSignal = deterministicNoSignalForOutcome;
          const threshold = workerPkg?.qaPolicy?.llmSecondPassImportanceThreshold ?? 4;
          const alwaysLlmForHighRisk = workerPkg?.qaPolicy?.alwaysLlmForHighRisk ?? false;
          const skipLlmOnPass = workerPkg?.qaPolicy?.skipLlmOnPass ?? false;
          const skipLlmCase = qaParsed.pass && !deterministicNoSignal && skipLlmOnPass;
          const runLlmQa =
            !skipLlmCase &&
            ((!qaParsed.pass) || deterministicNoSignal) &&
            (importance >= threshold || alwaysLlmForHighRisk);

          let ranLlmQa = false;
          if (runLlmQa) {
            if (deterministicNoSignal && ctx.runSessionId && ctx.ledger) {
              ctx.ledger.recordDecision(ctx.runSessionId, {
                type: "BUDGET_OPTIMIZATION",
                packageId: pkg.id,
                details: { qaSecondPassReason: "deterministic_no_signal", workerPackageId: workerId },
              });
            }
            const task: TaskCard = {
              id: pkg.id,
              taskType: "analysis",
              difficulty: "medium",
              constraints: { maxCostUSD: remainingUSD },
            };
            const byTrust = [...qaModels].sort(
              (a, b) => ctx.trustTracker.getTrust(b.id, "qa") - ctx.trustTracker.getTrust(a.id, "qa")
            );
            const qaPortfolioOpts =
              (portfolioMode === "prefer" || portfolioMode === "lock") && ctx.portfolio
                ? getPortfolioOptionsForQa(ctx.portfolio, portfolioMode)
                : undefined;
            const qaRoutingOptions =
              qaRegistryEntries && qaRegistryEntries.length > 0
                ? await (async () => {
                    const [{ scores, breakdowns }, priorsByModel] = await Promise.all([
                      computeCandidateScoresWithBreakdown(
                        qaRegistryEntries,
                        "analysis",
                        "medium",
                        currentTier,
                        remainingUSD
                      ),
                      (async () => {
                        const map = new Map<string, import("../model-hr/types.js").ModelPerformancePrior[]>();
                        await Promise.all(
                          qaRegistryEntries!.map(async (e) => {
                            try {
                              const priors = await loadPriorsForModel(e.id);
                              map.set(e.id, priors);
                            } catch {
                              map.set(e.id, []);
                            }
                          })
                        );
                        return map;
                      })(),
                    ]);
                    return {
                      candidateScores: scores,
                      candidateScoreBreakdowns: breakdowns,
                      cheapestViableChosen: enforceCheapestViable ?? false,
                      priorsByModel,
                    };
                  })()
                : undefined;
            const routing = ctx.route(
              task,
              byTrust.length > 0 ? byTrust : qaModels,
              undefined,
              pkg.description,
              qaPortfolioOpts,
              qaRoutingOptions
            );
            modelId = routing.chosenModelId ?? qaModels[0]?.id ?? "deterministic";
            const model = qaModels.find((m) => m.id === modelId);
            const excerptLen = excerpt.head.length + excerpt.tail.length || 500;
            const estimatedQaCost = model ? computeCost(model, 500 + excerptLen, 200) : 0.01;

            if (estimatedQaCost > remainingUSD) {
              modelId = "deterministic";
              qaCostUSD = 0;
              budgetGatedForOutcome = true;
              warnings.push(`qa_llm_second_pass_skipped_budget:${workerId}`);
              if (ctx.runSessionId && ctx.ledger) {
                ctx.ledger.recordDecision(ctx.runSessionId, {
                  type: "BUDGET_OPTIMIZATION",
                  packageId: pkg.id,
                  details: { qaSecondPassSkipped: true, reason: "budget_gated", workerPackageId: workerId },
                });
              }
            } else {
              if (ctx.runSessionId && ctx.ledger) {
                const candidates = routing.routingAudit?.candidates;
                const qaEstTokens = { input: 500 + excerptLen, output: 200 };
                const procurementCandidates = buildProcurementFilteredCandidates(
                  qaProcurementFiltered,
                  qaEstTokens,
                  "analysis",
                  "medium",
                  currentTier
                );
                const rawCandidates = candidates ? candidates.slice(0, ROUTING_CANDIDATES_CAP) : [];
                const allCandidates = [...procurementCandidates, ...rawCandidates].slice(0, ROUTING_CANDIDATES_CAP);
                const truncated = (procurementCandidates.length + (candidates?.length ?? 0)) > ROUTING_CANDIDATES_CAP;
                const registryForEnrich = [
                  ...(qaRegistryEntries ?? []),
                  ...(qaProcurementFiltered?.map((f) => f.entry) ?? []),
                ];
                const { candidates: routingCandidates, pricingMismatchCount, pricingMismatches } =
                  await enrichRoutingCandidatesWithPricing(
                    allCandidates,
                    registryForEnrich.length > 0 ? registryForEnrich : undefined,
                    qaEstTokens,
                    "analysis",
                    "medium",
                    currentTier
                  );
                const chosenCandidate = routingCandidates.find((c) => c.modelId === modelId);
                const qaPredictedCost = modelId !== "deterministic"
                  ? getChosenPredictedCostUSD(routing, modelId, 500 + excerptLen + 200, model ?? undefined)
                  : 0;
                if (modelId !== "deterministic") {
                  qaPredictedCostUSD = qaPredictedCost;
                  qaPredictedQuality = chosenCandidate?.predictedQuality ?? 0.5;
                }
                ctx.ledger.recordDecision(ctx.runSessionId, {
                  type: "ROUTE",
                  packageId: pkg.id,
                  details: {
                    taskType: "analysis",
                    difficulty: "medium",
                    tierProfile: currentTier,
                    chosenModelId: modelId,
                    trustUsed: modelId !== "deterministic" ? ctx.trustTracker.getTrust(modelId, "qa") : 1,
                    budgetRemaining: remainingUSD,
                    ...(portfolioMode && portfolioMode !== "off" && { portfolioMode }),
                    ...(routing.routingMeta?.portfolioBypassed && {
                      portfolioBypassed: true,
                      bypassReason: routing.routingMeta.reason,
                    }),
                    ...(candidates && candidates.length > 0 && {
                      routingCandidates,
                      ...(truncated && { candidatesTruncated: true }),
                      chosenPredictedCostUSD: qaPredictedCost,
                      chosenPredictedQuality: chosenCandidate?.predictedQuality,
                      chosenCandidateFound: chosenCandidate != null,
                    }),
                    ...(pricingMismatchCount > 0 && { pricingMismatchCount, pricingMismatches }),
                    ...(qaModelsUsedFallback && { modelHrFallback: true }),
                    ...(qaProcurementFallback && { procurementFallback: true }),
                    ...(routing.routingAudit?.enforceCheapestViable != null && {
                      enforceCheapestViable: routing.routingAudit.enforceCheapestViable,
                    }),
                    ...(routing.routingAudit?.chosenIsCheapestViable != null && {
                      chosenIsCheapestViable: routing.routingAudit.chosenIsCheapestViable,
                    }),
                    ...(routing.routingAudit?.rankedBy && { rankedBy: routing.routingAudit.rankedBy }),
                  },
                });
              }
              const criteriaBlock = (workerPkg?.acceptanceCriteria ?? []).map((c: string, i: number) => `${i + 1}. ${c}`).join("\n") || "N/A";
              const qaPrompt = deterministicNoSignal
                ? `You are a QA reviewer. Deterministic checks could not run (test/lint scripts missing). Please evaluate the worker output against the acceptance criteria.

Acceptance criteria:
${criteriaBlock}

Worker output (total ${excerpt.totalLength} chars${excerpt.isEvicted ? ", excerpt from evicted artifact" : ""}):
---
${workerOutputBlock || "(empty)"}
---

Respond with ONLY a JSON object (no markdown, no extra text):
{"pass": boolean, "qualityScore": number between 0 and 1, "defects": string[]}`
                : `You are a QA reviewer. Deterministic checks failed. Explain the failures.

Failed checks output:
${qaParsed.defects.join("\n\n")}

Worker output (total ${excerpt.totalLength} chars${excerpt.isEvicted ? ", excerpt from evicted artifact" : ""}):
---
${workerOutputBlock || "(empty)"}
---

Respond with ONLY a JSON object (no markdown, no extra text):
{"pass": boolean, "qualityScore": number between 0 and 1, "defects": string[]}`;

              let qaExecResult: LlmTextExecuteResult;
              try {
                qaExecResult = await ctx.llmTextExecute(modelId, qaPrompt);
              } catch (e) {
                return { outcome: null, warning: `QA ${pkg.id} LLM execution failed: ${e instanceof Error ? e.message : String(e)}` };
              }

              if (model && qaExecResult.usage?.totalTokens != null && qaExecResult.usage.totalTokens > 0) {
                const inT = qaExecResult.usage.inputTokens ?? 0;
                const outT = qaExecResult.usage.outputTokens ?? 0;
                if (inT > 0 || outT > 0) {
                  qaCostUSD = computeCost(model, inT || Math.round(qaExecResult.usage.totalTokens * 0.6), outT || Math.round(qaExecResult.usage.totalTokens * 0.4));
                } else {
                  qaCostUSD = computeCostFromTotal(model, qaExecResult.usage.totalTokens);
                }
              } else {
                qaCostUSD = model ? computeCost(model, 500 + excerptLen, 200) : 0.01;
              }

              if (qaCostUSD > remainingUSD) {
                modelId = "deterministic";
                qaCostUSD = 0;
                warnings.push(`qa_llm_second_pass_skipped_budget:${workerId}`);
                if (ctx.runSessionId && ctx.ledger) {
                  ctx.ledger.recordDecision(ctx.runSessionId, {
                    type: "BUDGET_OPTIMIZATION",
                    packageId: pkg.id,
                    details: { qaSecondPassSkipped: true, reason: "budget_gated", workerPackageId: workerId },
                  });
                }
              } else {
                try {
                  qaParsed = parseQaOutput(qaExecResult.text);
                  ranLlmQa = true;
                } catch (e) {
                  return { outcome: null, warning: `QA ${pkg.id} invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
                }
              }
            }
          }
          deterministicPassForOutcome = ranLlmQa ? deterministicPass : undefined;
          qaModeForOutcome = ranLlmQa ? "hybrid" : "deterministic";
        } else {
          if (outputValidation && !outputValidation.pass) {
            qaParsed = {
              pass: false,
              qualityScore: 0.3,
              defects: outputValidation.defects,
            };
            deterministicRan = true;
            deterministicPassForOutcome = false;
            qaModeForOutcome = "deterministic";
          } else {
          const task: TaskCard = {
            id: pkg.id,
            taskType: "analysis",
            difficulty: "medium",
            constraints: { maxCostUSD: remainingUSD },
          };
          const byTrust = [...qaModels].sort(
            (a, b) => ctx.trustTracker.getTrust(b.id, "qa") - ctx.trustTracker.getTrust(a.id, "qa")
          );
          const qaPortfolioOpts =
            (portfolioMode === "prefer" || portfolioMode === "lock") && ctx.portfolio
              ? getPortfolioOptionsForQa(ctx.portfolio, portfolioMode)
              : undefined;
          const qaRoutingOptions =
            qaRegistryEntries && qaRegistryEntries.length > 0
              ? await (async () => {
                  const [{ scores, breakdowns }, priorsByModel] = await Promise.all([
                    computeCandidateScoresWithBreakdown(
                      qaRegistryEntries,
                      "analysis",
                      "medium",
                      currentTier,
                      remainingUSD
                    ),
                    (async () => {
                      const map = new Map<string, import("../model-hr/types.js").ModelPerformancePrior[]>();
                      await Promise.all(
                        qaRegistryEntries!.map(async (e) => {
                          try {
                            const priors = await loadPriorsForModel(e.id);
                            map.set(e.id, priors);
                          } catch {
                            map.set(e.id, []);
                          }
                        })
                      );
                      return map;
                    })(),
                  ]);
                  return {
                    candidateScores: scores,
                    candidateScoreBreakdowns: breakdowns,
                    cheapestViableChosen: enforceCheapestViable ?? false,
                    priorsByModel,
                  };
                })()
              : undefined;
          const routing = ctx.route(
            task,
            byTrust.length > 0 ? byTrust : qaModels,
            undefined,
            pkg.description,
            qaPortfolioOpts,
            qaRoutingOptions
          );
          modelId = routing.chosenModelId ?? qaModels[0]?.id ?? "deterministic";
          if (!modelId) return { outcome: null, warning: null };
          const model = qaModels.find((m) => m.id === modelId);
          const qaEstTokensNum = (excerpt.head?.length ?? 0) + (excerpt.tail?.length ?? 0) || 500;
          const qaEstTokens = { input: 500 + qaEstTokensNum, output: 200 };
          if (ctx.runSessionId && ctx.ledger) {
            const candidates = routing.routingAudit?.candidates;
            const procurementCandidates = buildProcurementFilteredCandidates(
              qaProcurementFiltered,
              qaEstTokens,
              "analysis",
              "medium",
              currentTier
            );
            const rawCandidates = candidates ? candidates.slice(0, ROUTING_CANDIDATES_CAP) : [];
            const allCandidates = [...procurementCandidates, ...rawCandidates].slice(0, ROUTING_CANDIDATES_CAP);
            const truncated = (procurementCandidates.length + (candidates?.length ?? 0)) > ROUTING_CANDIDATES_CAP;
            const registryForEnrich = [
              ...(qaRegistryEntries ?? []),
              ...(qaProcurementFiltered?.map((f) => f.entry) ?? []),
            ];
            const { candidates: routingCandidates, pricingMismatchCount, pricingMismatches } =
              await enrichRoutingCandidatesWithPricing(
                allCandidates,
                registryForEnrich.length > 0 ? registryForEnrich : undefined,
                qaEstTokens,
                "analysis",
                "medium",
                currentTier
              );
            const chosenCandidate = routingCandidates.find((c) => c.modelId === modelId);
            const qaPredictedCost = modelId !== "deterministic"
              ? getChosenPredictedCostUSD(routing, modelId, 500 + qaEstTokensNum + 200, model ?? undefined)
              : 0;
            if (modelId !== "deterministic") {
              qaPredictedCostUSD = qaPredictedCost;
              qaPredictedQuality = chosenCandidate?.predictedQuality ?? 0.5;
            }
            ctx.ledger.recordDecision(ctx.runSessionId, {
              type: "ROUTE",
              packageId: pkg.id,
              details: {
                taskType: "analysis",
                difficulty: "medium",
                tierProfile: currentTier,
                chosenModelId: modelId,
                trustUsed: ctx.trustTracker.getTrust(modelId, "qa"),
                budgetRemaining: remainingUSD,
                ...(portfolioMode && portfolioMode !== "off" && { portfolioMode }),
                ...(routing.routingMeta?.portfolioBypassed && {
                  portfolioBypassed: true,
                  bypassReason: routing.routingMeta.reason,
                }),
                ...(candidates && candidates.length > 0 && {
                  routingCandidates,
                  ...(truncated && { candidatesTruncated: true }),
                  chosenPredictedCostUSD: qaPredictedCost,
                  chosenPredictedQuality: chosenCandidate?.predictedQuality,
                  chosenCandidateFound: chosenCandidate != null,
                }),
                ...(pricingMismatchCount > 0 && { pricingMismatchCount, pricingMismatches }),
                ...(qaModelsUsedFallback && { modelHrFallback: true }),
                ...(qaProcurementFallback && { procurementFallback: true }),
                ...(routing.routingAudit?.enforceCheapestViable != null && {
                  enforceCheapestViable: routing.routingAudit.enforceCheapestViable,
                }),
                ...(routing.routingAudit?.chosenIsCheapestViable != null && {
                  chosenIsCheapestViable: routing.routingAudit.chosenIsCheapestViable,
                }),
                ...(routing.routingAudit?.rankedBy && { rankedBy: routing.routingAudit.rankedBy }),
              },
            });
          }
          const criteriaBlock = (workerPkg?.acceptanceCriteria ?? []).map((c: string, i: number) => `${i + 1}. ${c}`).join("\n") || "N/A";
          const qaPrompt = `You are a QA reviewer. Evaluate the following worker output against the acceptance criteria.

Acceptance criteria:
${criteriaBlock}

Worker output (total ${excerpt.totalLength} chars${excerpt.isEvicted ? ", excerpt from evicted artifact" : ""}):
---
${workerOutputBlock || "(empty)"}
---

Respond with ONLY a JSON object (no markdown, no extra text):
{"pass": boolean, "qualityScore": number between 0 and 1, "defects": string[]}`;

          let qaExecResult: LlmTextExecuteResult;
          try {
            qaExecResult = await ctx.llmTextExecute(modelId, qaPrompt);
          } catch (e) {
            return { outcome: null, warning: `QA ${pkg.id} execution failed: ${e instanceof Error ? e.message : String(e)}` };
          }

          const excerptLen = excerpt.head.length + excerpt.tail.length || 500;
          if (model && qaExecResult.usage?.totalTokens != null && qaExecResult.usage.totalTokens > 0) {
            const inT = qaExecResult.usage.inputTokens ?? 0;
            const outT = qaExecResult.usage.outputTokens ?? 0;
            if (inT > 0 || outT > 0) {
              qaCostUSD = computeCost(model, inT || Math.round(qaExecResult.usage.totalTokens * 0.6), outT || Math.round(qaExecResult.usage.totalTokens * 0.4));
            } else {
              qaCostUSD = computeCostFromTotal(model, qaExecResult.usage.totalTokens);
            }
          } else {
            qaCostUSD = model ? computeCost(model, 500 + excerptLen, 200) : 0.01;
          }

          if (qaCostUSD > remainingUSD) return { outcome: null, warning: null };

          try {
            qaParsed = parseQaOutput(qaExecResult.text);
          } catch (e) {
            return { outcome: null, warning: `QA ${pkg.id} invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
          }
          }
        }

        if (workerId === "aggregation-report" && qaParsed.pass && ctx.runSessionId) {
          try {
            const parsed = JSON.parse(fullWorkerOutput.trim()) as AggregationArtifact;
            const result = await assembleDeliverable(ctx.runSessionId, parsed);
            const verify = await verifyAssemblyOutput(result.outputDir);
            if (!verify.success) {
              const compilerErrors = (verify.error ?? verify.stderr ?? verify.stdout).trim();
              qaParsed = {
                pass: false,
                qualityScore: 0.3,
                defects: [
                  "TypeScript compilation failed",
                  ...(compilerErrors ? compilerErrors.split("\n").map((l) => l.trim()).filter(Boolean) : []),
                ],
              };
              warnings.push(`aggregation-report TypeScript compilation failed: ${verify.error ?? "unknown"}`);
              if (ctx.ledger) {
                ctx.ledger.recordDecision(ctx.runSessionId, {
                  type: "ASSEMBLY",
                  packageId: workerId,
                  details: {
                    outputDir: result.outputDir,
                    fileCount: result.fileCount,
                    compilationSuccess: false,
                    compilerStderr: verify.stderr,
                    compilerStdout: verify.stdout,
                  },
                });
              }
            } else {
              if (ctx.ledger) {
                ctx.ledger.recordDecision(ctx.runSessionId, {
                  type: "ASSEMBLY",
                  packageId: workerId,
                  details: { outputDir: result.outputDir, fileCount: result.fileCount, compilationSuccess: true },
                });
              }
              console.log(`[runWorkPackages] Assembly completed for ${workerId}: ${result.fileCount} files -> ${result.outputDir}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            qaParsed = {
              pass: false,
              qualityScore: 0.3,
              defects: [...(qaParsed.defects ?? []), `Assembly failed: ${msg}`],
            };
            warnings.push(`aggregation-report assembly failed: ${msg}`);
            if (ctx.ledger) {
              ctx.ledger.recordDecision(ctx.runSessionId!, {
                type: "ASSEMBLY_FAILED",
                packageId: workerId,
                details: { error: msg },
              });
            }
            console.error(`[runWorkPackages] Assembly failed for ${workerId}:`, e);
          }
        }

        const outcome: QATaskOutcome = {
          type: "qa",
          packageId: pkg.id,
          workerPackageId: workerId,
          qaParsed,
          qaCostUSD,
          modelId,
          pkg,
          deterministicRan: deterministicRan || undefined,
          deterministicPass: deterministicPassForOutcome,
          ...(qaPredictedCostUSD != null && { qaPredictedCostUSD }),
          ...(qaPredictedQuality != null && { qaPredictedQuality }),
          ...(deterministicNoSignalForOutcome && { deterministicNoSignal: true }),
          ...(budgetGatedForOutcome && { budgetGated: true }),
          qaMode: qaModeForOutcome,
        };
        return { outcome, warning: null };
      });

      const qaRes = await Promise.all(qaPromises);
      const outcomes: TaskOutcome[] = [];
      for (const r of qaRes) {
        if (r.warning) warnings.push(r.warning);
        if (r.outcome) outcomes.push(r.outcome);
      }
      commitOutcomes(outcomes);
      notifyProgress(0);
    } else if (readyWorkers.length > 0 && remainingUSD > 0 && canRunWorkers) {
      const importance = 3;
      readyWorkers.sort((a, b) => {
        const pa = packagePriority(a, downstreamCount, importance, inferDifficulty(a));
        const pb = packagePriority(b, downstreamCount, importance, inferDifficulty(b));
        for (let i = 0; i < 4; i++) {
          if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
        }
        return 0;
      });

      const workerBatch = readyWorkers.splice(0, workerConcurrency);
      let batchCost = 0;
      for (const pkg of workerBatch) {
        const taskType = inferTaskType(pkg);
        const difficulty = inferDifficulty(pkg);
        const task: TaskCard = {
          id: pkg.id,
          taskType,
          difficulty,
          constraints: { maxCostUSD: remainingUSD },
        };
        const workerPortfolioOpts =
          (portfolioMode === "prefer" || portfolioMode === "lock") && ctx.portfolio
            ? getPortfolioOptionsForWorker(ctx.portfolio, taskType, portfolioMode)
            : undefined;
        const routing = ctx.route(task, modelsByTier, undefined, buildWorkerDirectiveForTokenEstimate(pkg), workerPortfolioOpts);
        const modelId = routing.chosenModelId;
        if (!modelId) continue;
        const model = modelsByTier.find((m) => m.id === modelId);
        const estInput = routing.estimatedTokens?.input ?? Math.round(pkg.estimatedTokens * 0.6);
        const estOutput = routing.estimatedTokens?.output ?? Math.round(pkg.estimatedTokens * 0.4);
        const cost = model ? computeCost(model, estInput, estOutput) : (pkg.estimatedTokens / 1000) * 0.01;
        batchCost += cost;
      }

      if (batchCost > remainingUSD && workerBatch.length > 0) {
        warnings.push(`Budget gating: batch predicted cost $${batchCost.toFixed(4)} exceeds remaining $${remainingUSD.toFixed(4)}; reducing batch`);
        const reduced: AtomicWorkPackage[] = [];
        let acc = 0;
        for (const pkg of workerBatch) {
          const taskType = inferTaskType(pkg);
          const difficulty = inferDifficulty(pkg);
          const task: TaskCard = { id: pkg.id, taskType, difficulty, constraints: { maxCostUSD: remainingUSD } };
          const workerPortfolioOpts =
            (portfolioMode === "prefer" || portfolioMode === "lock") && ctx.portfolio
              ? getPortfolioOptionsForWorker(ctx.portfolio, taskType, portfolioMode)
              : undefined;
          const routing = ctx.route(task, modelsByTier, undefined, buildWorkerDirectiveForTokenEstimate(pkg), workerPortfolioOpts);
          const modelId = routing.chosenModelId;
          if (!modelId) continue;
          const model = modelsByTier.find((m) => m.id === modelId);
          const estInput = routing.estimatedTokens?.input ?? Math.round(pkg.estimatedTokens * 0.6);
          const estOutput = routing.estimatedTokens?.output ?? Math.round(pkg.estimatedTokens * 0.4);
          const cost = model ? computeCost(model, estInput, estOutput) : (pkg.estimatedTokens / 1000) * 0.01;
          if (acc + cost <= remainingUSD) {
            reduced.push(pkg);
            acc += cost;
          } else {
            readyWorkers.unshift(pkg);
          }
        }
        workerBatch.length = 0;
        workerBatch.push(...reduced);
      }

      notifyProgress(workerBatch.length);

      const workerPromises = workerBatch.map(async (pkg) => {
        const taskType = inferTaskType(pkg);
        const difficulty = inferDifficulty(pkg);
        const task: TaskCard = {
          id: pkg.id,
          taskType,
          difficulty,
          constraints: { maxCostUSD: remainingUSD },
        };
        const workerPortfolioOpts =
          (portfolioMode === "prefer" || portfolioMode === "lock") && ctx.portfolio
            ? getPortfolioOptionsForWorker(ctx.portfolio, taskType, portfolioMode)
            : undefined;
        const effectiveTier = pkg.tierProfileOverride ?? currentTier;
        const useCheapestViable = pkg.cheapestViableChosen ?? enforceCheapestViable ?? false;
        const routerConfig =
          effectiveTier === "cheap"
            ? { thresholds: { low: 0.55, medium: 0.65, high: 0.75 } as Record<string, number> }
            : undefined;
        const workerRoutingOptions =
          workerRegistryEntries && workerRegistryEntries.length > 0
            ? await (async () => {
                const [{ scores, breakdowns }, priorsByModel] = await Promise.all([
                  computeCandidateScoresWithBreakdown(
                    workerRegistryEntries,
                    taskType,
                    difficulty,
                    effectiveTier,
                    remainingUSD
                  ),
                  (async () => {
                    const map = new Map<string, import("../model-hr/types.js").ModelPerformancePrior[]>();
                    await Promise.all(
                      workerRegistryEntries!.map(async (e) => {
                        try {
                          const priors = await loadPriorsForModel(e.id);
                          map.set(e.id, priors);
                        } catch {
                          map.set(e.id, []);
                        }
                      })
                    );
                    return map;
                  })(),
                ]);
                return {
                  candidateScores: scores,
                  candidateScoreBreakdowns: breakdowns,
                  cheapestViableChosen: useCheapestViable,
                  priorsByModel,
                };
              })()
            : undefined;
        const routing = ctx.route(
          task,
          modelsByTier,
          routerConfig,
          buildWorkerDirectiveForTokenEstimate(pkg),
          workerPortfolioOpts,
          workerRoutingOptions
        );
        const modelId = routing.chosenModelId;
        if (!modelId) return { outcome: null as TaskOutcome | null, warning: `No model for package ${pkg.id}` };
        const model = modelsByTier.find((m) => m.id === modelId);
        const predictedCostUSD = getChosenPredictedCostUSD(routing, modelId, pkg.estimatedTokens, model);
        if (ctx.runSessionId && ctx.ledger) {
          const candidates = routing.routingAudit?.candidates;
          const workerEstTokens = routing.estimatedTokens ?? {
            input: Math.round(pkg.estimatedTokens * 0.6),
            output: Math.round(pkg.estimatedTokens * 0.4),
          };
          const procurementCandidates = buildProcurementFilteredCandidates(
            workerProcurementFiltered,
            workerEstTokens,
            taskType,
            difficulty,
            effectiveTier
          );
          const rawCandidates = candidates ? candidates.slice(0, ROUTING_CANDIDATES_CAP) : [];
          const allCandidates = [...procurementCandidates, ...rawCandidates].slice(0, ROUTING_CANDIDATES_CAP);
          const truncated = (procurementCandidates.length + (candidates?.length ?? 0)) > ROUTING_CANDIDATES_CAP;
          const registryForEnrich = [
            ...(workerRegistryEntries ?? []),
            ...(workerProcurementFiltered?.map((f) => f.entry) ?? []),
          ];
          const { candidates: routingCandidates, pricingMismatchCount, pricingMismatches } =
            await enrichRoutingCandidatesWithPricing(
              allCandidates,
              registryForEnrich.length > 0 ? registryForEnrich : undefined,
              workerEstTokens,
              taskType,
              difficulty,
              effectiveTier
            );
          const chosenCandidate = routingCandidates.find((c) => c.modelId === modelId);
          ctx.ledger.recordDecision(ctx.runSessionId, {
            type: "ROUTE",
            packageId: pkg.id,
            details: {
              taskType,
              difficulty,
              tierProfile: effectiveTier,
              chosenModelId: modelId,
              trustUsed: ctx.trustTracker.getTrust(modelId, "worker"),
              budgetRemaining: remainingUSD,
              ...(portfolioMode && portfolioMode !== "off" && { portfolioMode }),
              ...(routing.routingMeta?.portfolioBypassed && {
                portfolioBypassed: true,
                bypassReason: routing.routingMeta.reason,
              }),
              ...(candidates && candidates.length > 0 && {
                routingCandidates,
                ...(truncated && { candidatesTruncated: true }),
                chosenPredictedCostUSD: predictedCostUSD,
                chosenPredictedQuality: chosenCandidate?.predictedQuality,
                chosenCandidateFound: chosenCandidate != null,
              }),
              ...(pricingMismatchCount > 0 && { pricingMismatchCount, pricingMismatches }),
              ...(modelsUsedFallback && { modelHrFallback: true }),
              ...(modelsProcurementFallback && { procurementFallback: true }),
              ...(routing.routingAudit?.enforceCheapestViable != null && {
                enforceCheapestViable: routing.routingAudit.enforceCheapestViable,
              }),
              ...(routing.routingAudit?.chosenIsCheapestViable != null && {
                chosenIsCheapestViable: routing.routingAudit.chosenIsCheapestViable,
              }),
              ...(routing.routingAudit?.rankedBy && { rankedBy: routing.routingAudit.rankedBy }),
            },
          });
        }
        const estInputTokens = routing.estimatedTokens?.input ?? Math.round(pkg.estimatedTokens * 0.6);
        const estOutputTokens = routing.estimatedTokens?.output ?? Math.round(pkg.estimatedTokens * 0.4);
        const workerTrust = ctx.trustTracker.getTrust(modelId, "worker");
        let basePred = model?.reliability ?? 0.7;
        basePred = trustWeightedScore(basePred, workerTrust);
        const cal = await ctx.varianceStatsTracker.getCalibration(modelId, taskType);
        if (cal.nQuality >= MIN_SAMPLES_FOR_QUALITY_BIAS && cal.qualityBias != null) {
          basePred += cal.qualityBias;
        }
        const predictedQuality = Math.max(0, Math.min(1, basePred));
        const dependencyArtifactsText = buildDependencyArtifactsText(pkg, registry);
        const prompt = buildWorkerPrompt(pkg, dependencyArtifactsText || undefined);

        let output: string;
        let actualCostUSD: number;
        let isEstimatedCost: boolean;

        if (pkg.id === "aggregation-report") {
          const missingDeps = getMissingDependencyIds(pkg, registry);
          if (missingDeps.length > 0) {
            output = AGGREGATION_REPORT_MISSING_DEPS_SYNTHETIC;
            actualCostUSD = 0;
            isEstimatedCost = false;
            const msg = `aggregation-report: dependency artifacts missing: ${missingDeps.join(", ")}`;
            warnings.push(msg);
            if (ctx.runSessionId && ctx.ledger) {
              ctx.ledger.recordDecision(ctx.runSessionId, {
                type: "ASSEMBLY_FAILED",
                packageId: pkg.id,
                details: { missingDependencies: missingDeps, reason: "dependency_artifacts_missing", error: msg },
              });
            }
          } else {
            let execResult: LlmTextExecuteResult;
            try {
              execResult = await ctx.llmTextExecute(modelId, prompt);
            } catch (e) {
              return { outcome: null, warning: `Package ${pkg.id} execution failed: ${e instanceof Error ? e.message : String(e)}` };
            }
            output = execResult.text;
            if (model && execResult.usage?.totalTokens != null && execResult.usage.totalTokens > 0) {
              const inT = execResult.usage.inputTokens ?? 0;
              const outT = execResult.usage.outputTokens ?? 0;
              actualCostUSD = inT > 0 || outT > 0
                ? computeCost(model, inT || Math.round(execResult.usage.totalTokens * 0.6), outT || Math.round(execResult.usage.totalTokens * 0.4))
                : computeCostFromTotal(model, execResult.usage.totalTokens);
              isEstimatedCost = false;
            } else {
              actualCostUSD = model ? computeCost(model, estInputTokens, estOutputTokens) : predictedCostUSD;
              isEstimatedCost = true;
            }
          }
        } else {
          let execResult: LlmTextExecuteResult;
          try {
            execResult = await ctx.llmTextExecute(modelId, prompt);
          } catch (e) {
            return { outcome: null, warning: `Package ${pkg.id} execution failed: ${e instanceof Error ? e.message : String(e)}` };
          }
          output = execResult.text;
          if (model && execResult.usage?.totalTokens != null && execResult.usage.totalTokens > 0) {
            const inT = execResult.usage.inputTokens ?? 0;
            const outT = execResult.usage.outputTokens ?? 0;
            actualCostUSD = inT > 0 || outT > 0
              ? computeCost(model, inT || Math.round(execResult.usage.totalTokens * 0.6), outT || Math.round(execResult.usage.totalTokens * 0.4))
              : computeCostFromTotal(model, execResult.usage.totalTokens);
            isEstimatedCost = false;
          } else {
            actualCostUSD = model ? computeCost(model, estInputTokens, estOutputTokens) : predictedCostUSD;
            isEstimatedCost = true;
          }
        }
        let selfConfidence: number | undefined;
        const confMatch = output.match(/\{"selfConfidence"\s*:\s*([\d.]+)\}/);
        if (confMatch) selfConfidence = Math.max(0, Math.min(1, parseFloat(confMatch[1])));

        const { artifactId, hash } = registry.createArtifact({
          packageId: pkg.id,
          modelId,
          content: output,
          createdAtISO: ctx.nowISO(),
        });

        const run: WorkerRun = {
          packageId: pkg.id,
          modelId,
          output,
          predictedQuality,
          predictedCostUSD,
          actualCostUSD,
          estimatedTokens: pkg.estimatedTokens,
          selfConfidence,
          isEstimatedCost,
          artifactId,
          artifactHash: hash,
        };

        const outcome: WorkerTaskOutcome = {
          type: "worker",
          packageId: pkg.id,
          run,
          actualCostUSD,
          pkg,
        };
        return { outcome, warning: null };
      });

      const workerResults = await Promise.all(workerPromises);
      const outcomes: TaskOutcome[] = [];
      for (const r of workerResults) {
        if (r.warning) warnings.push(r.warning);
        if (r.outcome) outcomes.push(r.outcome);
      }
      commitOutcomes(outcomes);
    } else {
      if (readyWorkers.length === 0 && readyQA.length === 0 && completed.size < packages.length) {
        const unresolved = packages.filter((p) => !completed.has(p.id));
        const deps = unresolved.map((p) => `${p.id} -> [${p.dependencies.join(", ")}]`).join("; ");
        throw new Error(
          `[runWorkPackages] Deadlock: queues empty but ${unresolved.length} packages unresolved. Unresolved: ${deps}`
        );
      }
      break;
    }

    if (remainingUSD <= 0) {
      if (readyWorkers.length > 0 || readyQA.length > 0) {
        warnings.push("Budget exhausted; stopping with partial results");
      }
      break;
    }
  }

  return {
    runs,
    qaResults,
    escalations,
    budget: { startingUSD: projectBudgetUSD, remainingUSD, escalationSpendUSD },
    warnings,
  };
}
