import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function GET() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set" },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });
    const models: Array<{ id: string; display_name: string; created_at: string; type: string }> = [];

    for await (const model of client.models.list()) {
      models.push({
        id: model.id,
        display_name: model.display_name,
        created_at: model.created_at,
        type: model.type,
      });
    }

    return NextResponse.json(models);
  } catch (err) {
    console.error("Debug anthropic-models error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list models" },
      { status: 500 }
    );
  }
}
