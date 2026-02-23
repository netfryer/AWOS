/**
 * Materializes assembled deliverable into a workspace directory.
 * Optionally commits as a git branch when env var is set.
 */

// ─── src/lib/execution/materializeDeliverable.ts ───────────────────────────

import { exec } from "child_process";
import { access, cp, mkdir, readdir, rm } from "fs/promises";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 10_000;

/** Env var to enable git checkout + add + commit after materializing. */
export const MATERIALIZE_GIT_COMMIT_ENV = "MATERIALIZE_DELIVERABLE_GIT_COMMIT";

/**
 * Validates that a relative path does not escape its root (blocks path traversal).
 */
function isPathSafe(relPath: string): boolean {
  const normalized = path.normalize(relPath).replace(/\\/g, "/");
  if (normalized.includes("..")) return false;
  if (normalized.startsWith("../") || normalized === "..") return false;
  return true;
}

/**
 * Cleans the target directory by removing all its contents (not the dir itself).
 */
async function cleanTargetDir(dir: string): Promise<void> {
  const absDir = path.resolve(dir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries) {
    const fullPath = path.join(absDir, entry);
    await rm(fullPath, { recursive: true, force: true });
  }
}

/**
 * Recursively copies files from outputDir to workspaceDir with path traversal protection.
 * @returns Number of files copied.
 */
async function copyWithPathTraversalProtection(
  outputDir: string,
  workspaceDir: string
): Promise<number> {
  const absOutput = path.resolve(outputDir);
  const absWorkspace = path.resolve(workspaceDir);

  try {
    await access(absOutput);
  } catch {
    throw new Error(`Output directory not found: ${outputDir}`);
  }

  await mkdir(absWorkspace, { recursive: true });
  await cleanTargetDir(absWorkspace);

  let count = 0;

  async function copyDir(dirRelPath: string): Promise<void> {
    const srcDir = path.join(absOutput, dirRelPath);
    const entries = await readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const relPath = dirRelPath ? path.join(dirRelPath, entry.name) : entry.name;
      if (!isPathSafe(relPath)) {
        throw new Error(`Path traversal rejected: "${relPath}"`);
      }
      const srcPath = path.join(absOutput, relPath);
      const destPath = path.join(absWorkspace, relPath);
      const destResolved = path.resolve(destPath);
      const workspaceWithSep = absWorkspace + path.sep;
      if (!destResolved.startsWith(workspaceWithSep) && destResolved !== absWorkspace) {
        throw new Error(`Path traversal rejected: "${relPath}"`);
      }
      if (entry.isDirectory()) {
        await mkdir(destPath, { recursive: true });
        await copyDir(relPath);
      } else if (entry.isFile()) {
        await mkdir(path.dirname(destPath), { recursive: true });
        await cp(srcPath, destPath, { force: true });
        count++;
      }
    }
  }

  await copyDir("");
  return count;
}

export interface MaterializeDeliverableResult {
  workspaceDir: string;
  fileCount: number;
  gitCommitted?: boolean;
}

/**
 * Materializes the assembled deliverable from outputDir into workspaceDir.
 * Cleans workspaceDir first, copies all files with path traversal protection.
 * If MATERIALIZE_DELIVERABLE_GIT_COMMIT is set, runs git checkout -b, add, commit.
 *
 * @param runSessionId - Run session ID (used for git branch name run/<id>)
 * @param outputDir - Source directory (e.g. .data/runs/<id>/output)
 * @param workspaceDir - Target directory to copy into
 */
export async function materializeDeliverableToWorkspace(
  runSessionId: string,
  outputDir: string,
  workspaceDir: string
): Promise<MaterializeDeliverableResult> {
  const absWorkspace = path.resolve(workspaceDir);
  const fileCount = await copyWithPathTraversalProtection(outputDir, absWorkspace);

  let gitCommitted = false;
  if (process.env[MATERIALIZE_GIT_COMMIT_ENV]) {
    const branchName = `run/${runSessionId}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(runSessionId)) {
      throw new Error(`runSessionId contains invalid characters for git branch: ${runSessionId}`);
    }
    try {
      await execAsync(`git checkout -b "${branchName}"`, {
        cwd: absWorkspace,
        timeout: GIT_TIMEOUT_MS,
      });
      await execAsync("git add .", {
        cwd: absWorkspace,
        timeout: GIT_TIMEOUT_MS,
      });
      await execAsync(`git commit -m "Deliverable for ${runSessionId}"`, {
        cwd: absWorkspace,
        timeout: GIT_TIMEOUT_MS,
      });
      gitCommitted = true;
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      const msg = [err.stderr, err.stdout, err.message].filter(Boolean).join("\n");
      throw new Error(`Git commit failed: ${msg}`);
    }
  }

  return {
    workspaceDir: absWorkspace,
    fileCount,
    gitCommitted: process.env[MATERIALIZE_GIT_COMMIT_ENV] ? gitCommitted : undefined,
  };
}
