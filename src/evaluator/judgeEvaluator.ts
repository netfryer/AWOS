/**
 * LLM-as-judge evaluator. Returns strict JSON EvalResult.
 * Uses AnthropicExecutor if ANTHROPIC_API_KEY exists; else OpenAIExecutor; else status:"error".
 */

import type { EvaluateInput, EvaluateResponse, EvalResult } from "./types.js";
import type { TaskType } from "../types.js";
import { AnthropicExecutor } from "../executor/anthropicExecutor.js";
import { OpenAIExecutor } from "../executor/openaiExecutor.js";

const DEFAULT_JUDGE_MODEL = "claude-sonnet-4-5-20250929";

function getJudgeModelId(): string {
  return process.env.JUDGE_MODEL_ID ?? DEFAULT_JUDGE_MODEL;
}

const TASK_WEIGHTS: Record<string, { correctness: number; compliance: number; completeness: number; clarity: number; safety: number }> = {
  code: { correctness: 0.5, compliance: 0.2, completeness: 0.15, clarity: 0.1, safety: 0.05 },
  analysis: { correctness: 0.3, compliance: 0.2, completeness: 0.25, clarity: 0.2, safety: 0.05 },
  writing: { correctness: 0.2, compliance: 0.25, completeness: 0.25, clarity: 0.25, safety: 0.05 },
  general: { correctness: 0.2375, compliance: 0.2375, completeness: 0.2375, clarity: 0.2375, safety: 0.05 },
};

function buildPrompt(input: EvaluateInput): string {
  const taskType = input.taskType in TASK_WEIGHTS ? input.taskType : "general";
  return `You are a strict expert evaluator. Rate the following output for a ${taskType} task.

**User directive:**
${input.directive}

**Output to evaluate:**
${input.outputText}

Respond with STRICT JSON only. No markdown, no code fences, no prose. The object MUST have exactly:
- "dimensions": { "correctness": number, "completeness": number, "clarity": number, "safety": number } — each 0-1
- "dimensionNotes": { "correctness": string, "completeness": string, "clarity": string, "safety": string } — each note ≤20 words
- "compliance": number 0-1 — how well the output followed the directive
- "notes": optional string (brief)

Scoring scale (be discriminating; reserve high scores for truly exceptional work):
- 0.95+ = rare, only exceptional
- 0.85 = very good
- 0.70 = acceptable but flawed
- 0.50 = mediocre
- 0.30 = poor

Penalize verbosity without substance. Be strict.`;
}

function parseEvalResult(text: string, taskType: string): EvalResult | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as unknown;
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    const o = obj as Record<string, unknown>;
    const dimensions = o.dimensions;
    if (typeof dimensions !== "object" || dimensions === null || Array.isArray(dimensions)) return null;
    const d = dimensions as Record<string, unknown>;
    const correctness = typeof d.correctness === "number" ? Math.max(0, Math.min(1, d.correctness)) : 0.5;
    const completeness = typeof d.completeness === "number" ? Math.max(0, Math.min(1, d.completeness)) : 0.5;
    const clarity = typeof d.clarity === "number" ? Math.max(0, Math.min(1, d.clarity)) : 0.5;
    const safety = typeof d.safety === "number" ? Math.max(0, Math.min(1, d.safety)) : 1;
    const compliance = typeof o.compliance === "number" ? Math.max(0, Math.min(1, o.compliance)) : null;
    if (compliance == null) return null;
    const dn = o.dimensionNotes;
    if (typeof dn !== "object" || dn === null || Array.isArray(dn)) return null;
    const dnRecord = dn as Record<string, unknown>;
    const dimNotes: { correctness: string; completeness: string; clarity: string; safety: string } = {
      correctness: typeof dnRecord.correctness === "string" ? dnRecord.correctness.slice(0, 200) : "",
      completeness: typeof dnRecord.completeness === "string" ? dnRecord.completeness.slice(0, 200) : "",
      clarity: typeof dnRecord.clarity === "string" ? dnRecord.clarity.slice(0, 200) : "",
      safety: typeof dnRecord.safety === "string" ? dnRecord.safety.slice(0, 200) : "",
    };
    const weights = TASK_WEIGHTS[taskType] ?? TASK_WEIGHTS.general;
    const overall =
      correctness * weights.correctness +
      compliance * weights.compliance +
      completeness * weights.completeness +
      clarity * weights.clarity +
      safety * weights.safety;
    return {
      overall: Math.max(0, Math.min(1, overall)),
      dimensions: { correctness, completeness, clarity, safety },
      dimensionNotes: dimNotes,
      compliance,
      notes: typeof o.notes === "string" ? o.notes : undefined,
    };
  } catch {
    return null;
  }
}

function computeCostUSD(
  usage: { inputTokens: number; outputTokens: number },
  modelId: string
): number {
  const pricing: Record<string, { in: number; out: number }> = {
    "claude-sonnet-4-5-20250929": { in: 0.003, out: 0.015 },
    "claude-haiku-4-5-20251001": { in: 0.00025, out: 0.00125 },
    "gpt-4o": { in: 0.0025, out: 0.01 },
    "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  };
  const p = pricing[modelId] ?? { in: 0.001, out: 0.003 };
  return (usage.inputTokens / 1000) * p.in + (usage.outputTokens / 1000) * p.out;
}

export async function evaluateWithJudge(input: EvaluateInput): Promise<EvaluateResponse> {
  const modelId = getJudgeModelId();
  const prompt = buildPrompt(input);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const executor = new AnthropicExecutor(process.env.ANTHROPIC_API_KEY);
      const result = await executor.execute({
        task: { id: "eval", taskType: input.taskType as TaskType, difficulty: "low" },
        modelId,
        prompt,
      });
      if (result.status === "error") {
        return { status: "error", error: result.error ?? "Evaluator execution failed" };
      }
      const parsed = parseEvalResult(result.outputText ?? "", input.taskType);
      if (!parsed) {
        return {
          status: "error",
          error: `Invalid JSON in evaluator response: ${(result.outputText ?? "").slice(0, 200)}`,
        };
      }
      const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
      return {
        status: "ok",
        result: parsed,
        usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
        costUSD: computeCostUSD(
          { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
          modelId
        ),
      };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const executor = new OpenAIExecutor(process.env.OPENAI_API_KEY);
      const result = await executor.execute({
        task: { id: "eval", taskType: input.taskType as TaskType, difficulty: "low" },
        modelId,
        prompt,
      });
      if (result.status === "error") {
        return { status: "error", error: result.error ?? "Evaluator execution failed" };
      }
      const parsed = parseEvalResult(result.outputText ?? "", input.taskType);
      if (!parsed) {
        return {
          status: "error",
          error: `Invalid JSON in evaluator response: ${(result.outputText ?? "").slice(0, 200)}`,
        };
      }
      const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
      return {
        status: "ok",
        result: parsed,
        usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
        costUSD: computeCostUSD(
          { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
          modelId
        ),
      };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { status: "error", error: "No ANTHROPIC_API_KEY or OPENAI_API_KEY for evaluator" };
}
