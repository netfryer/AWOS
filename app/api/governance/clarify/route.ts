import { NextRequest, NextResponse } from "next/server";
import { runExecutiveCouncil } from "../../../../src/governance/executiveCouncil";
import { getModelRegistryForRuntime } from "../../../../src/lib/model-hr/index";
import type { CeoDirectiveRequest } from "../../../../src/governance/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CeoDirectiveRequest;
    if (!body.directive?.trim()) {
      return NextResponse.json(
        { error: "Missing required field: directive" },
        { status: 400 }
      );
    }

    const { models: modelRegistry } = await getModelRegistryForRuntime();
    const result = await runExecutiveCouncil(
      body,
      modelRegistry,
      "./runs/governance.jsonl"
    );

    return NextResponse.json({
      run: result.run,
      brief: result.brief,
      gate: result.gate,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
