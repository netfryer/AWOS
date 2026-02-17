/**
 * Anthropic executor using the Messages API.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Executor, ExecutionRequest, ExecutionResult } from "./types.js";

export class AnthropicExecutor implements Executor {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key || key.trim() === "") {
      throw new Error(
        "ANTHROPIC_API_KEY is required for AnthropicExecutor. Set it in your environment."
      );
    }
    this.client = new Anthropic({ apiKey: key });
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    try {
      const response = await this.client.messages.create({
        model: req.modelId,
        max_tokens: 1500,
        temperature: 0.2,
        messages: [{ role: "user", content: req.prompt }],
      });

      const extractedText =
        response.content
          ?.filter((block) => block.type === "text")
          .map((block) => ("text" in block ? block.text : ""))
          .join("") ?? "";

      return {
        status: "ok",
        outputText: extractedText,
        usage: {
          inputTokens: response.usage?.input_tokens ?? undefined,
          outputTokens: response.usage?.output_tokens,
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
