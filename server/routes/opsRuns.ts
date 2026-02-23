/**
 * Ops runs API routes - deliverable zip download.
 */

import type { Request, Response } from "express";
import path from "path";
import { access } from "fs/promises";
import { createReadStream } from "fs";
import { zipDeliverable } from "../../src/lib/execution/zipDeliverable.js";

function paramId(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : (v ?? "");
}

export async function deliverableGet(req: Request, res: Response) {
  try {
    const runSessionId = paramId(req, "id");
    if (!runSessionId) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Run session id is required" },
      });
    }

    const baseDir = path.join(process.cwd(), ".data", "runs", runSessionId);
    const zipPath = path.join(baseDir, "deliverable.zip");
    const outputDir = path.join(baseDir, "output");

    let zipToServe = zipPath;

    try {
      await access(zipPath);
    } catch {
      try {
        await access(outputDir);
        zipToServe = await zipDeliverable(runSessionId);
      } catch {
        return res.status(404).json({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `No deliverable for run session: ${runSessionId}. Output directory not found.`,
          },
        });
      }
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="deliverable-${runSessionId}.zip"`
    );
    const stream = createReadStream(zipToServe);
    stream.pipe(res);
    stream.on("error", (e) => {
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: { code: "IO_ERROR", message: e instanceof Error ? e.message : "Failed to read zip" },
        });
      }
    });
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: e instanceof Error ? e.message : "Internal server error",
        },
      });
    }
  }
}
