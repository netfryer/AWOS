import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access, mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import {
  materializeDeliverableToWorkspace,
  MATERIALIZE_GIT_COMMIT_ENV,
} from "../materializeDeliverable.js";

describe("materializeDeliverableToWorkspace", () => {
  let tempRoot: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "materialize-"));
    originalEnv = process.env[MATERIALIZE_GIT_COMMIT_ENV];
    delete process.env[MATERIALIZE_GIT_COMMIT_ENV];
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env[MATERIALIZE_GIT_COMMIT_ENV] = originalEnv;
    } else {
      delete process.env[MATERIALIZE_GIT_COMMIT_ENV];
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("copies files from outputDir to workspaceDir and cleans target first", async () => {
    const outputDir = path.join(tempRoot, "output");
    const workspaceDir = path.join(tempRoot, "workspace");
    await mkdir(path.join(outputDir, "src"), { recursive: true });
    await writeFile(path.join(outputDir, "package.json"), '{"name":"test"}', "utf-8");
    await writeFile(path.join(outputDir, "src", "index.ts"), "export const x = 1;", "utf-8");

    const result = await materializeDeliverableToWorkspace("run-1", outputDir, workspaceDir);

    expect(result.workspaceDir).toBe(path.resolve(workspaceDir));
    expect(result.fileCount).toBe(2);

    const pkg = JSON.parse(await readFile(path.join(workspaceDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("test");

    const indexContent = await readFile(path.join(workspaceDir, "src", "index.ts"), "utf-8");
    expect(indexContent).toBe("export const x = 1;");
  });

  it("cleans workspace before copying (removes existing content)", async () => {
    const outputDir = path.join(tempRoot, "output");
    const workspaceDir = path.join(tempRoot, "workspace");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "new.txt"), "new content", "utf-8");

    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, "old.txt"), "old content", "utf-8");

    await materializeDeliverableToWorkspace("run-2", outputDir, workspaceDir);

    await expect(access(path.join(workspaceDir, "new.txt"))).resolves.toBeUndefined();
    await expect(access(path.join(workspaceDir, "old.txt"))).rejects.toThrow();
  });

  it("throws when outputDir does not exist", async () => {
    const outputDir = path.join(tempRoot, "nonexistent");
    const workspaceDir = path.join(tempRoot, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await expect(
      materializeDeliverableToWorkspace("run-3", outputDir, workspaceDir)
    ).rejects.toThrow(/Output directory not found|not found/);
  });

  it("copies nested directory structure", async () => {
    const outputDir = path.join(tempRoot, "output");
    const workspaceDir = path.join(tempRoot, "workspace");
    await mkdir(path.join(outputDir, "src", "lib"), { recursive: true });
    await writeFile(path.join(outputDir, "src", "lib", "util.ts"), "export {};", "utf-8");

    const result = await materializeDeliverableToWorkspace("run-4", outputDir, workspaceDir);

    expect(result.fileCount).toBe(1);
    const content = await readFile(path.join(workspaceDir, "src", "lib", "util.ts"), "utf-8");
    expect(content).toBe("export {};");
  });

  it("does not run git when env var is unset", async () => {
    const outputDir = path.join(tempRoot, "output");
    const workspaceDir = path.join(tempRoot, "workspace");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "a.txt"), "a", "utf-8");

    const result = await materializeDeliverableToWorkspace("run-5", outputDir, workspaceDir);

    expect(result.gitCommitted).toBeUndefined();
  });
});
