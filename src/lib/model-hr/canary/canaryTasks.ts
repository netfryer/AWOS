/**
 * Built-in canary suite: 5–8 tasks across writing/code/analysis/general.
 * Prompts request JSON where applicable for deterministic evaluation.
 */

import type { CanaryTask } from "./types.js";

const JSON_INSTRUCTION = `Respond with ONLY a valid JSON object. No markdown, no code fences, no text before or after.`;

export const DEFAULT_CANARY_SUITE: CanaryTask[] = [
  {
    id: "write-summary",
    name: "Writing: Summarize in one sentence",
    taskType: "writing",
    difficulty: "low",
    prompt: `Summarize the following in exactly one sentence: "The quick brown fox jumps over the lazy dog. This is a common pangram used for typing practice."
${JSON_INSTRUCTION}
{"summary": "your one sentence here"}`,
    expectedJsonSchema: { summary: "string" },
    evaluationMethod: "json_schema",
  },
  {
    id: "code-hello",
    name: "Code: Hello world function",
    taskType: "code",
    difficulty: "low",
    prompt: `Write a JavaScript function named greet that returns "Hello, World!" when called. No arguments.
${JSON_INSTRUCTION}
{"code": "function greet() { return \\"Hello, World!\\"; }"}`,
    expectedJsonSchema: { code: "string" },
    evaluationMethod: "json_schema",
  },
  {
    id: "code-parse",
    name: "Code: Parse CSV line",
    taskType: "code",
    difficulty: "medium",
    prompt: `Write a JavaScript function parseCsvLine(line) that splits a CSV line by commas, respecting quoted strings. Example: parseCsvLine('a,"b,c",d') returns ['a','b,c','d'].
${JSON_INSTRUCTION}
{"code": "function parseCsvLine(line) { ... }"}`,
    expectedJsonSchema: { code: "string" },
    evaluationMethod: "json_schema",
  },
  {
    id: "analysis-compare",
    name: "Analysis: Compare two options",
    taskType: "analysis",
    difficulty: "medium",
    prompt: `Compare Option A (cost $10, 2-day delivery) vs Option B (cost $8, 5-day delivery). Which is better for urgent needs?
${JSON_INSTRUCTION}
{"recommendation": "A" or "B", "reason": "brief reason"}`,
    expectedJsonSchema: { recommendation: "string", reason: "string" },
    evaluationMethod: "json_schema",
  },
  {
    id: "analysis-extract",
    name: "Analysis: Extract key facts",
    taskType: "analysis",
    difficulty: "low",
    prompt: `Extract the main facts from: "Sales increased 15% in Q3. Revenue was $2.1M. The team grew to 12 people."
${JSON_INSTRUCTION}
{"facts": ["fact1", "fact2", ...]}`,
    expectedJsonSchema: { facts: "array" },
    evaluationMethod: "json_schema",
  },
  {
    id: "general-json",
    name: "General: Structured response",
    taskType: "general",
    difficulty: "low",
    prompt: `List 3 primary colors.
${JSON_INSTRUCTION}
{"colors": ["color1", "color2", "color3"]}`,
    expectedJsonSchema: { colors: "array" },
    evaluationMethod: "json_schema",
  },
  {
    id: "general-math",
    name: "General: Simple arithmetic",
    taskType: "general",
    difficulty: "low",
    prompt: `What is 17 + 25? Respond with only the number.
${JSON_INSTRUCTION}
{"answer": 42}`,
    expectedJsonSchema: { answer: "number" },
    evaluationMethod: "json_schema",
  },
  {
    id: "writing-format",
    name: "Writing: Format as list",
    taskType: "writing",
    difficulty: "medium",
    prompt: `Convert to a bullet list: "Apples, oranges, and bananas are fruits."
${JSON_INSTRUCTION}
{"items": ["item1", "item2", ...]}`,
    expectedJsonSchema: { items: "array" },
    evaluationMethod: "json_schema",
  },
];
