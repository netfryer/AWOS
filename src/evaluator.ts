/**
 * LLM-as-judge evaluation layer.
 * Applies refusal/template penalties before or after LLM scoring.
 */

import type { TaskType } from "./types.js";
import { AnthropicExecutor } from "./executor/anthropicExecutor.js";

const EVALUATOR_MODEL = "claude-sonnet-4-5-20250929";

/** Refusal phrases: score set to 0.05 (near-zero) when matched. */
const REFUSAL_PATTERNS = [
  "i don't have access",
  "i do not have access",
  "i can't access",
  "i cannot access",
  "as an ai",
  "i'm unable to",
  "i am unable to",
  "please provide",
  "need more information",
  "i need more information",
  "i need some information",
  "i need you to",
  "i can help with a template",
  "i cannot do that",
];

function isRefusal(outputText: string): boolean {
  const lower = outputText.toLowerCase().trim();
  return REFUSAL_PATTERNS.some((p) => lower.includes(p));
}

/** Template/placeholder patterns: cap score at 0.2 when matched. */
function isTemplatePlaceholder(outputText: string): boolean {
  if (outputText.includes("This is a sample paragraph")) return true;
  const bracketPlaceholders = outputText.match(/\[[^\]]+\]/g);
  return (bracketPlaceholders?.length ?? 0) >= 3;
}

function buildEvaluationPrompt(
  taskType: TaskType,
  directive: string,
  outputText: string
): string {
  const criteria =
    taskType === "writing"
      ? "clarity, structure, persuasiveness, completeness"
      : taskType === "analysis"
        ? "depth, coherence, structure"
        : taskType === "code"
          ? "correctness, clarity, robustness"
          : "relevance and clarity";

  return `You are an expert evaluator. Rate the following output for a ${taskType} task.

Criteria to consider: ${criteria}

**User directive:**
${directive}

**Output to evaluate:**
${outputText}

Respond ONLY with a number between 0 and 1 (e.g., 0.82).`;
}

function parseQualityScore(text: string): number {
  const match = text.match(/[0-9]*\.?[0-9]+/);
  if (!match) return 0.5;
  const n = parseFloat(match[0]);
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export async function evaluateOutput(args: {
  taskType: TaskType;
  directive: string;
  outputText: string;
}): Promise<{ qualityScore: number }> {
  const { taskType, directive, outputText } = args;

  if (isRefusal(outputText)) {
    return { qualityScore: 0.05 };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const executor = new AnthropicExecutor(apiKey);

  const prompt = buildEvaluationPrompt(taskType, directive, outputText);

  const result = await executor.execute({
    task: {
      id: "eval",
      taskType,
      difficulty: "low",
    },
    modelId: EVALUATOR_MODEL,
    prompt,
  });

  if (result.status === "error") {
    throw new Error(result.error ?? "Evaluator execution failed");
  }

  let qualityScore = parseQualityScore(result.outputText ?? "");

  if (isTemplatePlaceholder(outputText)) {
    qualityScore = Math.min(qualityScore, 0.2);
  }

  return { qualityScore };
}
