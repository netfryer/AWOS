/**
 * LLM JSON execution adapter: forces JSON output, parses robustly, validates with Zod.
 */

import type { z } from "zod";
import { createExecutor } from "../../executor/index.js";
import type { TaskType } from "../../types.js";

export type LlmExecuteJson = (
  modelId: string,
  prompt: string
) => Promise<unknown>;

export interface LlmExecuteJsonStrictArgs {
  modelId: string;
  prompt: string;
  zodSchema: z.ZodTypeAny;
  executorContext?: {
    openaiExecutor?: { execute: (req: unknown) => Promise<{ outputText: string; status: string }> };
    anthropicExecutor?: { execute: (req: unknown) => Promise<{ outputText: string; status: string }> };
  };
}

const JSON_ONLY_SYSTEM = `You must respond with ONLY a valid JSON object. No markdown, no code fences, no explanatory text before or after.`;

const SNIPPET_MAX = 400;

function snippet(text: string): string {
  const s = String(text).trim();
  if (s.length <= SNIPPET_MAX) return s;
  return s.slice(0, SNIPPET_MAX) + "...";
}

function stripMarkdownFences(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = s.match(fence);
  if (m) return m[1].trim();
  const open = s.indexOf("```");
  if (open >= 0) {
    const after = s.slice(open + 3);
    const close = after.indexOf("```");
    if (close >= 0) return after.slice(0, close).trim();
    return after.trim();
  }
  return s;
}

/**
 * Extracts the first complete JSON value (object or array) by tracking balanced braces,
 * nesting depth for {} and [], and string mode for double quotes with backslash escapes.
 */
export function extractFirstJsonValue(text: string): string {
  const stripped = stripMarkdownFences(text);
  const trimmed = stripped.trim();
  const first = trimmed[0];
  if (first === "{" || first === "[") {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      /* fall through to scan */
    }
  }
  const objStart = stripped.indexOf("{");
  const arrStart = stripped.indexOf("[");
  let start: number;
  let depthObj: number;
  let depthArr: number;
  if (objStart < 0 && arrStart < 0) {
    throw new Error(`No JSON object or array found. Output: ${snippet(text)}`);
  }
  if (arrStart < 0 || (objStart >= 0 && objStart < arrStart)) {
    start = objStart;
    depthObj = 1;
    depthArr = 0;
  } else {
    start = arrStart;
    depthObj = 0;
    depthArr = 1;
  }
  let inString = false;
  let escape = false;
  let i = start + 1;
  while (i < stripped.length) {
    const c = stripped[i];
    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      i++;
      continue;
    }
    if (c === "{") depthObj++;
    else if (c === "}") depthObj--;
    else if (c === "[") depthArr++;
    else if (c === "]") depthArr--;
    i++;
    if (depthObj === 0 && depthArr === 0) return stripped.slice(start, i);
  }
  throw new Error(`Incomplete JSON (unbalanced braces). Output: ${snippet(text)}`);
}

function parseJsonRobust(text: string): unknown {
  const extracted = extractFirstJsonValue(text);
  try {
    return JSON.parse(extracted) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`JSON parse failed: ${msg}. Output: ${snippet(text)}`);
  }
}

/** Zod v4 moved _def to _zod.def; support both. */
function isObjectSchema(schema: z.ZodTypeAny): boolean {
  try {
    const s = schema as { _def?: { typeName?: string }; _zod?: { def?: { typeName?: string } } };
    const def = s._zod?.def ?? s._def;
    return def?.typeName === "ZodObject";
  } catch {
    return false;
  }
}

/** Safely extract Zod error details for serialization; avoids triggering Zod v4 internals. */
function zodErrorToPlainDetails(err: unknown): { path: unknown[]; message: string }[] {
  try {
    const e = err as { issues?: unknown[] };
    const issues = e?.issues;
    if (!Array.isArray(issues)) return [];
    return issues.map((i) => {
      const item = i as { path?: unknown[]; message?: string };
      return { path: item.path ?? [], message: item.message ?? "invalid" };
    });
  } catch {
    return [];
  }
}

export async function llmExecuteJsonStrict(
  args: LlmExecuteJsonStrictArgs
): Promise<unknown> {
  const { modelId, prompt, zodSchema } = args;
  if (zodSchema == null) {
    throw new Error("llmExecuteJsonStrict: missing zodSchema");
  }
  const executor = createExecutor(modelId);

  const task = {
    id: "json-exec",
    taskType: "general" as TaskType,
    difficulty: "low" as const,
  };

  const wrappedPrompt = `${JSON_ONLY_SYSTEM}\n\n${prompt}`;

  const result = await executor.execute({
    task,
    modelId,
    prompt: wrappedPrompt,
  });

  if (result.status === "error") {
    throw new Error(result.error ?? "Executor failed");
  }

  const parsed = parseJsonRobust(result.outputText);

  let schemaToUse: z.ZodTypeAny = zodSchema;
  try {
    if (isObjectSchema(zodSchema) && typeof (zodSchema as z.ZodObject<z.ZodRawShape>).strict === "function") {
      schemaToUse = (zodSchema as z.ZodObject<z.ZodRawShape>).strict();
    }
  } catch {
    schemaToUse = zodSchema;
  }

  let validated: { success: true; data: unknown } | { success: false; error: unknown };
  try {
    validated = schemaToUse.safeParse(parsed) as typeof validated;
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    if (msg.includes("_zod")) {
      validated = zodSchema.safeParse(parsed) as typeof validated;
    } else {
      throw parseErr;
    }
  }

  if (!validated.success) {
    const issues = zodErrorToPlainDetails(validated.error);
    const details = { issues };
    throw new Error(
      `Schema validation failed: ${JSON.stringify(details)}. Output: ${snippet(result.outputText)}`
    );
  }

  return validated.data;
}
