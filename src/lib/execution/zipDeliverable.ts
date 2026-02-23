/**
 * Zips the assembled deliverable output directory for download.
 */

// ─── src/lib/execution/zipDeliverable.ts ────────────────────────────────────

import archiver from "archiver";
import { createWriteStream } from "fs";
import { access, mkdir } from "fs/promises";
import path from "path";

/**
 * Zips the output directory for a run session.
 * Source: .data/runs/<runSessionId>/output/
 * Output: .data/runs/<runSessionId>/deliverable.zip
 * Overwrites existing zip if present.
 * @returns Absolute path to the created zip file.
 */
export async function zipDeliverable(runSessionId: string): Promise<string> {
  const baseDir = path.join(process.cwd(), ".data", "runs", runSessionId);
  const outputDir = path.join(baseDir, "output");
  const zipPath = path.join(baseDir, "deliverable.zip");

  try {
    await access(outputDir);
  } catch (err) {
    throw new Error(
      `Output directory not found: ${outputDir}. Run assembleDeliverable first.`
    );
  }

  await mkdir(baseDir, { recursive: true });

  return new Promise<string>((resolve, reject) => {
    const output = createWriteStream(zipPath, { flags: "w" });
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(path.resolve(zipPath)));
    output.on("error", (err) => reject(err));

    archive.on("error", (err) => reject(err));
    archive.on("warning", (err) => {
      if (err.code === "ENOENT") return;
      reject(err);
    });

    archive.pipe(output);
    archive.directory(outputDir, false);
    archive.finalize();
  });
}
