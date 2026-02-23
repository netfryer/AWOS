/**
 * Deterministic assembly layer for aggregation artifacts.
 * Materializes validated JSON artifacts to disk.
 */

// ─── src/lib/execution/assembleDeliverable.ts ───────────────────────────────

import { createHash } from "crypto";
import { exec } from "child_process";
import { access, mkdir, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { ensureDeliverableTsconfig } from "./deliverableTsconfig.js";

const execAsync = promisify(exec);

const TSC_VERIFY_TIMEOUT_MS = 20_000;

export interface AggregationArtifact {
  fileTree: string[];
  files: Record<string, string>;
  report: {
    summary: string;
    aggregations: Record<string, unknown>;
  };
}

export interface AssembleDeliverableResult {
  outputDir: string;
  fileCount: number;
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

/**
 * Normalizes a file path and rejects path traversal.
 * Returns null if path is invalid (contains ../ or escapes root).
 */
function normalizeAndValidatePath(relPath: string): string | null {
  const trimmed = relPath.trim();
  if (!trimmed) return null;
  if (trimmed.includes("..")) return null;
  const normalized = path.normalize(trimmed).replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

/**
 * Assembles a validated aggregation artifact to disk.
 * Creates .data/runs/<runSessionId>/output/ and writes all files.
 */
export async function assembleDeliverable(
  runSessionId: string,
  artifact: AggregationArtifact
): Promise<AssembleDeliverableResult> {
  const baseDir = path.join(process.cwd(), ".data", "runs", runSessionId, "output");
  await mkdir(baseDir, { recursive: true });

  const fileHashes: Record<string, string> = {};
  const fileTree = artifact.fileTree ?? [];
  const files = artifact.files ?? {};

  for (const relPath of fileTree) {
    const safePath = normalizeAndValidatePath(relPath);
    if (!safePath) {
      throw new Error(`Path traversal or invalid path rejected: "${relPath}"`);
    }
    const content = files[relPath];
    if (content === undefined) {
      throw new Error(`Missing content for fileTree path: "${relPath}"`);
    }
    const fullPath = path.join(baseDir, safePath);
    const dir = path.dirname(fullPath);
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    fileHashes[safePath] = sha256(content);
  }

  const reportPath = path.join(baseDir, "report.json");
  await writeFile(reportPath, JSON.stringify(artifact.report, null, 2), "utf-8");

  const generatedAtISO = new Date().toISOString();
  const manifest = {
    runSessionId,
    fileCount: fileTree.length,
    generatedAtISO,
    fileHashes,
  };
  const manifestPath = path.join(baseDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  await ensureDeliverableTsconfig(baseDir);

  return {
    outputDir: baseDir,
    fileCount: fileTree.length,
  };
}

export interface VerifyAssemblyResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Runs npx tsc -p <tsconfig> to verify TypeScript compilation.
 * Uses harness-provided tsconfig (from ensureDeliverableTsconfig).
 * Runs from process.cwd() so npx finds project's typescript; -p points to output tsconfig.
 * Timeout: 20 seconds.
 */
export async function verifyAssemblyOutput(outputDir: string): Promise<VerifyAssemblyResult> {
  const absDir = path.resolve(outputDir);
  const tsconfigPath = path.join(absDir, "tsconfig.json");
  try {
    const { stdout, stderr } = await execAsync(`npx tsc -p "${tsconfigPath}"`, {
      cwd: process.cwd(),
      timeout: TSC_VERIFY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const distIndexPath = path.join(absDir, "dist", "index.js");
    try {
      await access(distIndexPath);
    } catch {
      return {
        success: false,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        error: "Compilation succeeded but dist/index.js was not produced",
      };
    }
    return { success: true, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const stdout = err.stdout ?? "";
    const stderr = err.stderr ?? "";
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    const errorMsg = err.killed ? "TypeScript compilation timed out" : (err.message ?? String(e));
    return {
      success: false,
      stdout,
      stderr,
      error: combined || errorMsg,
    };
  }
}
