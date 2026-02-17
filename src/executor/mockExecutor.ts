/**
 * Mock executor for testing. Simulates latency and returns deterministic outputs.
 * Trigger behaviors via prompt substrings:
 * - __FAIL__: always returns execution error
 * - __FAIL_ONCE__: returns execution error only on first attempt (no RETRY in prompt)
 * - __UNCERTAIN__: returns "I am not sure" (fails validation)
 */

import type { Executor, ExecutionRequest, ExecutionResult } from "./types.js";

/** Deterministic outputs by task type */
const OUTPUTS: Record<string, string> = {
  code: 'function greet() { return "Hello, world!"; }',
  writing:
    "This is a sample paragraph generated for the writing task. It contains multiple sentences to demonstrate coherent text output.",
  analysis:
    "- Key finding one: initial observation.\n- Key finding two: secondary observation.\n- Conclusion: summary of analysis.",
  general:
    "Here is a general response to your request. It covers the main points in a straightforward manner.",
};

/** Random delay between min and max ms */
function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockExecutor: Executor = {
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const start = Date.now();
    const isRetry = req.prompt.includes("RETRY");

    if (req.prompt.includes("__FAIL__")) {
      await delay(50, 150);
      return {
        status: "error",
        outputText: "",
        error: "Forced failure for testing",
        latencyMs: Date.now() - start,
      };
    }

    if (req.prompt.includes("__FAIL_ONCE__") && !isRetry) {
      await delay(50, 150);
      return {
        status: "error",
        outputText: "",
        error: "Forced failure for testing (once)",
        latencyMs: Date.now() - start,
      };
    }

    if (req.prompt.includes("__UNCERTAIN__") && !isRetry) {
      await delay(50, 150);
      return {
        status: "ok",
        outputText: "I am not sure",
        usage: { inputTokens: req.prompt.length, outputTokens: 12 },
        latencyMs: Date.now() - start,
      };
    }

    await delay(50, 150);
    const outputText = OUTPUTS[req.task.taskType] ?? OUTPUTS.general;

    return {
      status: "ok",
      outputText,
      usage: {
        inputTokens: req.prompt.length,
        outputTokens: outputText.length,
      },
      latencyMs: Date.now() - start,
    };
  },
};
