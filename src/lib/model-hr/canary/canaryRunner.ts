/**
 * Model HR Canary Runner: runs standardized tasks against a model, records results.
 * Uses llmTextExecute; never throws on single task failure.
 */

import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { llmTextExecute } from "../../llm/llmTextExecute.js";
import { getModel } from "../registry/index.js";
import { extractFirstJsonValue } from "../../llm/llmExecuteJson.js";
import { DEFAULT_CANARY_SUITE } from "./canaryTasks.js";
import type { CanaryTask, CanaryRunResult, CanarySuiteResult } from "./types.js";

function getDataDir(): string {
  return process.env.MODEL_HR_DATA_DIR ?? join(process.cwd(), ".data", "model-hr");
}

function getCanariesDir(): string {
  return join(getDataDir(), "canaries");
}

function computeCostUSD(
  inTokens: number,
  outTokens: number,
  inPer1k: number,
  outPer1k: number
): number {
  return (inTokens / 1000) * inPer1k + (outTokens / 1000) * outPer1k;
}

function validateJsonSchema(
  obj: unknown,
  schema: Record<string, unknown>
): { valid: boolean; defects: string[] } {
  const defects: string[] = [];
  if (obj == null || typeof obj !== "object") {
    return { valid: false, defects: ["Output is not a JSON object"] };
  }
  const o = obj as Record<string, unknown>;
  for (const [key, expectedType] of Object.entries(schema)) {
    if (!(key in o)) {
      defects.push(`Missing required key: ${key}`);
      continue;
    }
    const val = o[key];
    const typeStr = String(expectedType).toLowerCase();
    if (typeStr === "string" && typeof val !== "string") {
      defects.push(`Key "${key}" expected string, got ${typeof val}`);
    } else if (typeStr === "number" && typeof val !== "number") {
      defects.push(`Key "${key}" expected number, got ${typeof val}`);
    } else if (typeStr === "array" && !Array.isArray(val)) {
      defects.push(`Key "${key}" expected array, got ${typeof val}`);
    } else if (typeStr === "object" && (val == null || typeof val !== "object" || Array.isArray(val))) {
      defects.push(`Key "${key}" expected object, got ${typeof val}`);
    }
  }
  return { valid: defects.length === 0, defects };
}

function evaluateOutput(
  task: CanaryTask,
  output: string
): { pass: boolean; qualityScore: number; defects: string[] } {
  const defects: string[] = [];
  const trimmed = output.trim();
  if (!trimmed) {
    return { pass: false, qualityScore: 0, defects: ["Empty output"] };
  }

  if (task.evaluationMethod === "pass_through") {
    return { pass: true, qualityScore: 1, defects: [] };
  }

  if (task.evaluationMethod === "contains" && task.expectedJsonSchema) {
    const expectedKeys = Object.keys(task.expectedJsonSchema);
    const hasAll = expectedKeys.every((k) => trimmed.includes(k));
    return {
      pass: hasAll,
      qualityScore: hasAll ? 1 : 0.5,
      defects: hasAll ? [] : [`Output missing expected content: ${expectedKeys.join(", ")}`],
    };
  }

  if (task.evaluationMethod === "json_schema") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractFirstJsonValue(output));
    } catch (e) {
      defects.push(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return { pass: false, qualityScore: 0, defects };
    }
    if (task.expectedJsonSchema) {
      const { valid, defects: schemaDefects } = validateJsonSchema(parsed, task.expectedJsonSchema);
      defects.push(...schemaDefects);
      return {
        pass: valid,
        qualityScore: valid ? 1 : Math.max(0, 1 - defects.length * 0.2),
        defects,
      };
    }
    return { pass: true, qualityScore: 1, defects: [] };
  }

  return { pass: true, qualityScore: 1, defects: [] };
}

async function runSingleTask(
  modelId: string,
  task: CanaryTask
): Promise<CanaryRunResult> {
  const tsISO = new Date().toISOString();
  const start = Date.now();
  let output = "";
  let inTokens = 0;
  let outTokens = 0;

  try {
    const result = await llmTextExecute(modelId, task.prompt);
    output = result.text ?? "";
    inTokens = result.usage?.inputTokens ?? 0;
    outTokens = result.usage?.outputTokens ?? 0;
  } catch (e) {
    const latencyMs = Date.now() - start;
    return {
      modelId,
      taskId: task.id,
      pass: false,
      qualityScore: 0,
      defects: [`Execution failed: ${e instanceof Error ? e.message : String(e)}`],
      latencyMs,
      tsISO,
    };
  }

  const latencyMs = Date.now() - start;
  const { pass, qualityScore, defects } = evaluateOutput(task, output);

  let costUSD: number | undefined;
  const model = await getModel(modelId);
  if (model?.pricing && (inTokens > 0 || outTokens > 0)) {
    costUSD = computeCostUSD(
      inTokens,
      outTokens,
      model.pricing.inPer1k,
      model.pricing.outPer1k
    );
  }

  return {
    modelId,
    taskId: task.id,
    pass,
    qualityScore,
    defects,
    latencyMs,
    costUSD,
    tsISO,
  };
}

async function appendCanaryResult(modelId: string, result: CanaryRunResult): Promise<void> {
  try {
    const dir = getCanariesDir();
    await mkdir(dir, { recursive: true });
    const safeId = modelId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = join(dir, `${safeId}.jsonl`);
    await appendFile(path, JSON.stringify(result) + "\n", "utf-8");
  } catch {
    /* never fail run */
  }
}

export interface RunCanaryOptions {
  modelId: string;
  suite?: CanaryTask[];
  suiteId?: string;
}

export async function runCanary(options: RunCanaryOptions): Promise<CanarySuiteResult> {
  const { modelId, suite = DEFAULT_CANARY_SUITE, suiteId = "default" } = options;
  const results: CanaryRunResult[] = [];

  for (const task of suite) {
    const result = await runSingleTask(modelId, task);
    results.push(result);
    await appendCanaryResult(modelId, result);
  }

  const failedCount = results.filter((r) => !r.pass).length;
  const avgQuality =
    results.length > 0
      ? results.reduce((s, r) => s + r.qualityScore, 0) / results.length
      : 0;
  const pass = failedCount === 0 && avgQuality >= 0.7;

  return {
    suiteId,
    modelId,
    results,
    pass,
    avgQuality,
    failedCount,
  };
}
