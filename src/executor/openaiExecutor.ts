/**
 * OpenAI executor using the official Chat Completions API.
 */

import OpenAI from "openai";
import type { Executor, ExecutionRequest, ExecutionResult } from "./types.js";

export class OpenAIExecutor implements Executor {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key || key.trim() === "") {
      throw new Error(
        "OPENAI_API_KEY is required for OpenAIExecutor. Set it in your environment."
      );
    }
    this.client = new OpenAI({ apiKey: key });
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: req.modelId,
        messages: [{ role: "user", content: req.prompt }],
        temperature: 0.2,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content ?? "";
      return {
        status: "ok",
        outputText: content,
        usage: {
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        },
      };
    } catch (error) {
      return {
        status: "error",
        outputText: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
