/**
 * Deterministic conversion of ProjectPlan subtasks into atomic work packages.
 * Uses Director layer for acceptance criteria, QA policy, and test plans.
 * Worker packages + optional QA packages for medium/high difficulty.
 */

// ─── src/lib/planning/packageWork.ts ────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ProjectPlan, WorkPackage } from "../schemas/governance.js";
import {
  getAcceptanceCriteria,
  getAcceptanceCriteriaForPackage,
  type TaskType,
  type Difficulty,
} from "./directorCriteria.js";
import { chooseQaPolicy, type QaPolicy } from "./directorQaPolicy.js";

export type { QaPolicy } from "./directorQaPolicy.js";
export type { TaskType, Difficulty } from "./directorCriteria.js";

// ─── Output Types ───────────────────────────────────────────────────────────

export type WorkPackageRole = "Worker" | "QA";

export interface QaCheckShell {
  type: "shell";
  name: string;
  command: string;
  args: string[];
}

export interface AtomicWorkPackage {
  id: string;
  role: WorkPackageRole;
  name: string;
  description?: string;
  acceptanceCriteria: string[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies: string[];
  estimatedTokens: number;
  qaChecks?: QaCheckShell[];
  importance?: number;
  taskType?: TaskType;
  difficulty?: Difficulty;
  qaPolicy?: QaPolicy;
  /** Override tier for routing (e.g. strategy→premium, workers→cheap). */
  tierProfileOverride?: "cheap" | "standard" | "premium";
  /** Override cheapestViableChosen for this package (e.g. workers→true). */
  cheapestViableChosen?: boolean;
}

/** QA package output contract */
export const QA_OUTPUT_SCHEMA = {
  pass: "boolean",
  qualityScore: "number (0..1)",
  defects: "string[]",
} as const;

// ─── Deterministic Inference ────────────────────────────────────────────────

function inferTaskType(name: string, description: string): TaskType {
  const text = `${name} ${description}`.toLowerCase();
  if (/\b(implement|code|build|create|develop|write|fix|add|refactor)\b/.test(text))
    return "implementation";
  if (/\b(research|analyze|investigate|explore)\b/.test(text)) return "research";
  if (/\b(review|audit|verify|check|validate)\b/.test(text)) return "review";
  if (/\b(document|docs|readme|guide|manual)\b/.test(text)) return "documentation";
  if (/\b(strategy|plan|roadmap|architecture)\b/.test(text)) return "strategy";
  return "implementation";
}

function inferDifficulty(name: string, description: string): Difficulty {
  const text = `${name} ${description}`.toLowerCase();
  const len = description.length;
  if (/\b(complex|critical|comprehensive|advanced)\b/.test(text) || len > 200)
    return "high";
  if (/\b(simple|quick|basic|minor)\b/.test(text) || len < 50) return "low";
  return "medium";
}

// ─── Test Plan (implementation tasks) ───────────────────────────────────────

function buildTestPlanFromPackageJson(cwd: string): QaCheckShell[] | null {
  try {
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) return null;
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg?.scripts;
    if (!scripts || typeof scripts !== "object") return null;

    const hasTest = typeof scripts.test === "string";
    const hasLint = typeof scripts.lint === "string";
    if (!hasTest && !hasLint) return null;

    const checks: QaCheckShell[] = [];
    if (hasTest) {
      checks.push({ type: "shell", name: "npm test", command: "npm", args: ["test"] });
    }
    if (hasLint) {
      checks.push({
        type: "shell",
        name: "npm run lint",
        command: "npm",
        args: ["run", "lint"],
      });
    }
    return checks;
  } catch {
    return null;
  }
}

function defaultQaChecksForNode(): QaCheckShell[] {
  return [
    { type: "shell", name: "npm test", command: "npm", args: ["test"] },
    { type: "shell", name: "npm run lint", command: "npm", args: ["run", "lint"] },
  ];
}

function buildQaChecksForImplementation(
  taskType: TaskType,
  cwd?: string
): QaCheckShell[] {
  if (taskType !== "implementation") return [];
  const resolved = cwd ?? process.cwd();
  const fromPkg = buildTestPlanFromPackageJson(resolved);
  return fromPkg ?? defaultQaChecksForNode();
}

// ─── Risk Score from Plan ───────────────────────────────────────────────────

function deriveRiskScore(plan: ProjectPlan): number {
  const risks = plan.risks;
  if (!risks || risks.length === 0) return 0;
  const severityToScore = { low: 0.2, med: 0.5, high: 0.8 } as const;
  let maxScore = 0;
  for (const r of risks) {
    const score =
      r.likelihood ?? severityToScore[r.severity as keyof typeof severityToScore] ?? 0.5;
    maxScore = Math.max(maxScore, Math.min(1, score));
  }
  return maxScore;
}

// ─── Token Estimation Heuristic ──────────────────────────────────────────────

function estimateTokens(
  role: WorkPackageRole,
  description: string,
  difficulty: Difficulty
): number {
  const baseInput = 500 + Math.min(description.length * 2, 3000);
  const baseOutput = role === "Worker" ? 800 : 200;
  const mult = difficulty === "low" ? 0.7 : difficulty === "medium" ? 1 : 1.5;
  return Math.round((baseInput + baseOutput) * mult);
}

function importanceFromDifficulty(difficulty: Difficulty): number {
  return difficulty === "high" ? 4 : difficulty === "medium" ? 3 : 2;
}

// ─── Main Conversion ─────────────────────────────────────────────────────────

export interface PackageWorkOptions {
  cwd?: string;
}

/**
 * Converts plan subtasks into atomic work packages with Worker/QA roles,
 * Director acceptance criteria, QA policy, test plans, and token estimates.
 */
export function packageWork(
  plan: ProjectPlan,
  options?: PackageWorkOptions
): AtomicWorkPackage[] {
  const packages: AtomicWorkPackage[] = [];
  const wpById = new Map<string, WorkPackage>();
  const cwd = options?.cwd ?? process.cwd();
  const riskScore = deriveRiskScore(plan);

  for (const wp of plan.workPackages) {
    wpById.set(wp.id, wp);
  }

  for (const wp of plan.workPackages) {
    const taskType = inferTaskType(wp.name, wp.description ?? "");
    const difficulty = inferDifficulty(wp.name, wp.description ?? "");
    const importance = importanceFromDifficulty(difficulty);

    const qaChecks = buildQaChecksForImplementation(taskType, cwd);
    const hasDeterministicChecks = qaChecks.length > 0;

    const qaPolicy = chooseQaPolicy({
      importance,
      difficulty,
      hasDeterministicChecks,
      riskScore,
    });

    const workerInputs: Record<string, unknown> = {
      directive: plan.objective,
      taskDescription: wp.description ?? wp.name,
      deliverables: wp.deliverables ?? [],
    };

    const workerOutputs: Record<string, unknown> = {
      result: "string | object",
      status: "complete | partial | failed",
    };

    const workerPackage: AtomicWorkPackage = {
      id: wp.id,
      role: "Worker",
      name: wp.name,
      description: wp.description,
      acceptanceCriteria: getAcceptanceCriteriaForPackage(wp.id, taskType, difficulty),
      inputs: workerInputs,
      outputs: workerOutputs,
      dependencies: wp.dependencies ?? [],
      estimatedTokens: estimateTokens("Worker", wp.description ?? wp.name, difficulty),
      qaChecks: qaChecks.length > 0 ? qaChecks : undefined,
      importance,
      taskType,
      difficulty,
      qaPolicy,
    };

    packages.push(workerPackage);

    if (difficulty === "medium" || difficulty === "high") {
      const qaId = `${wp.id}-qa`;
      const qaPackage: AtomicWorkPackage = {
        id: qaId,
        role: "QA",
        name: `QA: ${wp.name}`,
        description: `Quality assurance for "${wp.name}"`,
        acceptanceCriteria: [
          "QA output includes pass (boolean), qualityScore (0..1), defects (string[])",
          "All defects are actionable and specific",
          "qualityScore reflects objective assessment of output quality",
        ],
        inputs: {
          workerOutput: "output from Worker package",
          workerPackageId: wp.id,
          acceptanceCriteria: workerPackage.acceptanceCriteria,
        },
        outputs: {
          pass: "boolean",
          qualityScore: "number (0..1)",
          defects: "string[]",
        },
        dependencies: [wp.id],
        estimatedTokens: estimateTokens("QA", wp.description ?? wp.name, difficulty),
      };

      packages.push(qaPackage);
    }
  }

  return packages;
}

// ─── Validator ───────────────────────────────────────────────────────────────

function isValidQaPolicy(p: unknown): p is QaPolicy {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.deterministicFirst === "boolean" &&
    typeof o.llmSecondPassImportanceThreshold === "number" &&
    typeof o.skipLlmOnPass === "boolean" &&
    typeof o.alwaysLlmForHighRisk === "boolean"
  );
}

export function validateWorkPackages(packages: AtomicWorkPackage[]): void {
  const ids = new Set(packages.map((p) => p.id));
  const seen = new Set<string>();

  for (let i = 0; i < packages.length; i++) {
    const p = packages[i];

    if (!p.id || typeof p.id !== "string") {
      throw new Error(`[packageWork] Package at index ${i}: missing or invalid id`);
    }
    if (seen.has(p.id)) {
      throw new Error(`[packageWork] Duplicate package id: ${p.id}`);
    }
    seen.add(p.id);

    if (p.role !== "Worker" && p.role !== "QA") {
      throw new Error(
        `[packageWork] Package ${p.id}: role must be "Worker" or "QA", got "${p.role}"`
      );
    }

    if (!Array.isArray(p.acceptanceCriteria)) {
      throw new Error(`[packageWork] Package ${p.id}: acceptanceCriteria must be an array`);
    }
    if (p.role === "Worker" && p.acceptanceCriteria.length < 3) {
      throw new Error(
        `[packageWork] Package ${p.id}: Worker packages require at least 3 acceptance criteria, got ${p.acceptanceCriteria.length}`
      );
    }
    if (p.acceptanceCriteria.some((c) => typeof c !== "string")) {
      throw new Error(`[packageWork] Package ${p.id}: all acceptanceCriteria must be strings`);
    }

    if (typeof p.inputs !== "object" || p.inputs === null) {
      throw new Error(`[packageWork] Package ${p.id}: inputs must be a non-null object`);
    }
    if (typeof p.outputs !== "object" || p.outputs === null) {
      throw new Error(`[packageWork] Package ${p.id}: outputs must be a non-null object`);
    }

    if (p.role === "QA") {
      const hasPass = "pass" in p.outputs;
      const hasQualityScore = "qualityScore" in p.outputs;
      const hasDefects = "defects" in p.outputs;
      if (!hasPass || !hasQualityScore || !hasDefects) {
        throw new Error(
          `[packageWork] Package ${p.id}: QA outputs must include pass, qualityScore, defects`
        );
      }
      if (p.dependencies.length !== 1) {
        throw new Error(
          `[packageWork] Package ${p.id}: QA package must have exactly 1 dependency, got ${p.dependencies.length}`
        );
      }
      const depPkg = packages.find((x) => x.id === p.dependencies[0]);
      if (!depPkg || depPkg.role !== "Worker") {
        throw new Error(
          `[packageWork] Package ${p.id}: QA dependency "${p.dependencies[0]}" must reference a Worker package`
        );
      }
    }

    if (p.qaPolicy != null && !isValidQaPolicy(p.qaPolicy)) {
      throw new Error(
        `[packageWork] Package ${p.id}: qaPolicy must have deterministicFirst, llmSecondPassImportanceThreshold, skipLlmOnPass, alwaysLlmForHighRisk`
      );
    }

    if (p.qaChecks != null) {
      if (!Array.isArray(p.qaChecks)) {
        throw new Error(`[packageWork] Package ${p.id}: qaChecks must be an array`);
      }
      for (let j = 0; j < p.qaChecks.length; j++) {
        const c = p.qaChecks[j];
        if (typeof c !== "object" || c === null) {
          throw new Error(`[packageWork] Package ${p.id}: qaChecks[${j}] must be an object`);
        }
        if (c.type !== "shell") {
          throw new Error(`[packageWork] Package ${p.id}: qaChecks[${j}].type must be "shell"`);
        }
        if (typeof c.name !== "string") {
          throw new Error(`[packageWork] Package ${p.id}: qaChecks[${j}].name must be a string`);
        }
        if (typeof c.command !== "string") {
          throw new Error(`[packageWork] Package ${p.id}: qaChecks[${j}].command must be a string`);
        }
        if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== "string")) {
          throw new Error(
            `[packageWork] Package ${p.id}: qaChecks[${j}].args must be string[]`
          );
        }
      }
    }

    if (!Array.isArray(p.dependencies)) {
      throw new Error(`[packageWork] Package ${p.id}: dependencies must be an array`);
    }
    for (const dep of p.dependencies) {
      if (!ids.has(dep)) {
        throw new Error(
          `[packageWork] Package ${p.id}: dependency "${dep}" does not reference a valid package id`
        );
      }
      if (dep === p.id) {
        throw new Error(`[packageWork] Package ${p.id}: cannot depend on itself`);
      }
    }

    if (typeof p.estimatedTokens !== "number" || p.estimatedTokens < 0) {
      throw new Error(
        `[packageWork] Package ${p.id}: estimatedTokens must be a non-negative number, got ${p.estimatedTokens}`
      );
    }
  }

  const cycles = detectCycles(packages);
  if (cycles.length > 0) {
    throw new Error(
      `[packageWork] Circular dependencies detected: ${cycles.map((c) => c.join(" -> ")).join("; ")}`
    );
  }
}

function detectCycles(packages: AtomicWorkPackage[]): string[][] {
  const idToIndex = new Map<string, number>();
  packages.forEach((p, i) => idToIndex.set(p.id, i));

  const cycles: string[][] = [];
  const visited = new Set<number>();
  const recStack = new Set<number>();
  const path: string[] = [];
  const pathSet = new Set<string>();
  const cycleMap = new Map<string, number>();

  function dfs(i: number): boolean {
    const p = packages[i];
    visited.add(i);
    recStack.add(i);
    path.push(p.id);
    pathSet.add(p.id);

    for (const depId of p.dependencies) {
      const j = idToIndex.get(depId);
      if (j == null) continue;
      if (!visited.has(j)) {
        if (dfs(j)) return true;
      } else if (recStack.has(j)) {
        const cycleStart = path.indexOf(depId);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart);
          cycle.push(depId);
          const key = cycle.sort().join(",");
          if (!cycleMap.has(key)) {
            cycleMap.set(key, 1);
            cycles.push(cycle);
          }
        }
      }
    }

    path.pop();
    pathSet.delete(p.id);
    recStack.delete(i);
    return false;
  }

  for (let i = 0; i < packages.length; i++) {
    if (!visited.has(i)) dfs(i);
  }

  return cycles;
}
