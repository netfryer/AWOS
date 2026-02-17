/**
 * Executor factory: returns OpenAIExecutor for gpt-*, AnthropicExecutor for claude-*, MockExecutor otherwise.
 */

import type { Executor } from "./types.js";
import { OpenAIExecutor } from "./openaiExecutor.js";
import { AnthropicExecutor } from "./anthropicExecutor.js";
import { mockExecutor } from "./mockExecutor.js";

export function createExecutor(modelId: string): Executor {
  if (modelId.startsWith("gpt-")) {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    return new OpenAIExecutor(apiKey);
  }
  if (modelId.startsWith("claude-")) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    return new AnthropicExecutor(apiKey);
  }
  return mockExecutor;
}
