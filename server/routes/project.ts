import type { Request, Response } from "express";
import { estimateProjectWithROI } from "../../src/project/estimateProject.js";
import { runProject } from "../../src/project/runProject.js";
import type { ProjectRequest } from "../../src/project/types.js";

export async function estimatePost(req: Request, res: Response) {
  try {
    const body = req.body as ProjectRequest;
    const { directive, taskType, difficulty, profile, projectBudgetUSD, constraints } = body;
    if (directive == null || directive === "" || !taskType || !difficulty || profile == null || projectBudgetUSD == null || typeof projectBudgetUSD !== "number") {
      return res.status(400).json({ error: "Missing required fields: directive, taskType, difficulty, profile, projectBudgetUSD" });
    }
    const result = await estimateProjectWithROI({
      directive: String(directive),
      taskType,
      difficulty,
      profile: String(profile),
      projectBudgetUSD,
      constraints,
    });
    res.json(result);
  } catch (err) {
    console.error("API /api/project/estimate error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}

export async function runPost(req: Request, res: Response) {
  try {
    const body = req.body as ProjectRequest;
    const { directive, taskType, difficulty, profile, projectBudgetUSD, constraints } = body;
    if (directive == null || directive === "" || !taskType || !difficulty || profile == null || projectBudgetUSD == null || typeof projectBudgetUSD !== "number") {
      return res.status(400).json({ error: "Missing required fields: directive, taskType, difficulty, profile, projectBudgetUSD" });
    }
    const result = await runProject({
      directive: String(directive),
      taskType,
      difficulty,
      profile: String(profile),
      projectBudgetUSD,
      constraints,
    });
    res.json(result);
  } catch (err) {
    console.error("API /api/project/run error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
