/**
 * Decomposes a directive into subtasks using gpt-4o-mini.
 */

import type { TaskType, Difficulty } from "../types.js";
import type { RecommendedTier } from "./types.js";
import { OpenAIExecutor } from "../executor/openaiExecutor.js";

const DECOMPOSER_MODEL = "gpt-4o-mini";
const MAX_SUBTASKS = 5;

export interface DecomposedSubtask {
  title: string;
  description: string;
  taskType: TaskType;
  difficulty: Difficulty;
  importance: number;
  recommendedTier?: RecommendedTier;
}

const PROMPT = `Decompose the following directive into discrete subtasks. Return a STRICT JSON array only, no other text.

Format:
[
  { "title": "...", "description": "...", "taskType": "writing|analysis|code|general", "difficulty": "low|medium|high", "importance": 1-5, "recommendedTier": "cheap|standard|premium" },
  ...
]

Rules:
- taskType must be one of: writing, analysis, code, general
- difficulty must be one of: low, medium, high
- importance: 1-5 scale
  5 = critical strategic section
  4 = high-value section
  3 = supporting content
  2 = structural/organizational
  1 = low-value / mechanical
- recommendedTier:
  cheap = commodity work
  standard = meaningful reasoning required
  premium = strategic narrative or synthesis
- Maximum 5 subtasks
- Each subtask must be actionable and self-contained

Directive:
`;

function clampImportance(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function parseSubtasks(text: string, fallbackDirective: string): DecomposedSubtask[] {
  try {
    const trimmed = text.trim();
    const jsonStart = trimmed.indexOf("[");
    const jsonEnd = trimmed.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error("No JSON array found");
    }
    const jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr) as unknown[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Invalid or empty array");
    }
    const items: DecomposedSubtask[] = [];
    const validTaskTypes: TaskType[] = ["writing", "analysis", "code", "general"];
    const validDifficulties: Difficulty[] = ["low", "medium", "high"];
    const validTiers: RecommendedTier[] = ["cheap", "standard", "premium"];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const title = String(obj.title ?? "").trim();
      const description = String(obj.description ?? "").trim();
      const taskType = validTaskTypes.includes(obj.taskType as TaskType)
        ? (obj.taskType as TaskType)
        : "general";
      const difficulty = validDifficulties.includes(obj.difficulty as Difficulty)
        ? (obj.difficulty as Difficulty)
        : "medium";
      const importance = clampImportance(Number(obj.importance) || 3);
      const recommendedTier = validTiers.includes(obj.recommendedTier as RecommendedTier)
        ? (obj.recommendedTier as RecommendedTier)
        : "standard";
      if (title || description) {
        items.push({
          title: title || "Subtask",
          description: description || title,
          taskType,
          difficulty,
          importance,
          recommendedTier,
        });
      }
    }
    if (items.length === 0) throw new Error("No valid subtasks");
    return items.slice(0, MAX_SUBTASKS);
  } catch {
    return [
      {
        title: "Main task",
        description: fallbackDirective,
        taskType: "general",
        difficulty: "medium",
        importance: 3,
        recommendedTier: "standard",
      },
    ];
  }
}

export async function decomposeDirective(directive: string): Promise<DecomposedSubtask[]> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const executor = new OpenAIExecutor(apiKey);

  const result = await executor.execute({
    task: { id: "decompose", taskType: "general", difficulty: "low" },
    modelId: DECOMPOSER_MODEL,
    prompt: PROMPT + directive,
  });

  if (result.status === "error") {
    throw new Error(result.error ?? "Decomposition failed");
  }

  return parseSubtasks(result.outputText ?? "", directive);
}
