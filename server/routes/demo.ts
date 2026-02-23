import type { Request, Response } from "express";
import { listDemoRuns, loadDemoRun } from "../../app/lib/demoRunsStore.js";

function paramId(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : (v ?? "");
}

export async function demoRunsGet(req: Request, res: Response) {
  try {
    const limit = Math.min(
      Math.max(1, Number(req.query.limit) || 20),
      100
    );
    const runs = await listDemoRuns(limit);
    res.json({ success: true, runs });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function demoRunByIdGet(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id?.trim()) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Missing id" } });
    }
    const payload = await loadDemoRun(id);
    if (!payload) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Run ${id} not found` } });
    }
    res.json({ success: true, run: payload });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}
