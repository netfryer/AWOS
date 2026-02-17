import { NextRequest, NextResponse } from "next/server";
import { runProject } from "../../../../dist/src/project/runProject.js";
import type { ProjectRequest, ProjectResult } from "../../../../dist/src/project/types.js";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ProjectRequest;
    const { directive, taskType, difficulty, profile, projectBudgetUSD, constraints } = body;

    if (
      directive == null ||
      directive === "" ||
      !taskType ||
      !difficulty ||
      profile == null ||
      projectBudgetUSD == null ||
      typeof projectBudgetUSD !== "number"
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: directive, taskType, difficulty, profile, projectBudgetUSD",
        },
        { status: 400 }
      );
    }

    const result: ProjectResult = await runProject({
      directive: String(directive),
      taskType,
      difficulty,
      profile: String(profile),
      projectBudgetUSD,
      constraints,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("API /api/project/run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
