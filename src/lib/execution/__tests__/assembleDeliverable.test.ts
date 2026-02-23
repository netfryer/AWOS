import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access, mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { assembleDeliverable, verifyAssemblyOutput } from "../assembleDeliverable.js";
import { ensureDeliverableTsconfig } from "../deliverableTsconfig.js";
import { zipDeliverable } from "../zipDeliverable.js";

describe("assembleDeliverable", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "assemble-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes files and manifest", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    try {
      const artifact = {
        fileTree: ["src/index.ts", "src/utils.ts"],
        files: {
          "src/index.ts": "export {};",
          "src/utils.ts": "export const x = 1;",
        },
        report: {
          summary: "Test summary",
          aggregations: { count: 5 },
        },
      };
      const result = await assembleDeliverable("test-session-123", artifact);
      expect(result.fileCount).toBe(2);
      expect(result.outputDir).toContain(".data");
      expect(result.outputDir).toContain("test-session-123");
      expect(result.outputDir).toContain("output");

      const reportPath = path.join(result.outputDir, "report.json");
      const reportRaw = await readFile(reportPath, "utf-8");
      const report = JSON.parse(reportRaw);
      expect(report.summary).toBe("Test summary");
      expect(report.aggregations).toEqual({ count: 5 });

      const manifestPath = path.join(result.outputDir, "manifest.json");
      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.runSessionId).toBe("test-session-123");
      expect(manifest.fileCount).toBe(2);
      expect(manifest.generatedAtISO).toBeDefined();
      expect(Object.keys(manifest.fileHashes)).toHaveLength(2);

      const tsconfigPath = path.join(result.outputDir, "tsconfig.json");
      await access(tsconfigPath);
      const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));
      expect(tsconfig.compilerOptions.rootDir).toBe("./src");
    } finally {
      process.chdir(cwd);
    }
  });

  it("zipDeliverable creates zip and returns absolute path", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    try {
      const artifact = {
        fileTree: ["a.txt"],
        files: { "a.txt": "hello" },
        report: { summary: "x", aggregations: {} },
      };
      await assembleDeliverable("zip-session", artifact);
      const zipPath = await zipDeliverable("zip-session");
      expect(path.isAbsolute(zipPath)).toBe(true);
      expect(zipPath).toContain("deliverable.zip");
      await access(zipPath);
    } finally {
      process.chdir(cwd);
    }
  });

  it("zipDeliverable throws when output dir missing", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    try {
      await expect(zipDeliverable("nonexistent-session")).rejects.toThrow(/not found|Output directory/);
    } finally {
      process.chdir(cwd);
    }
  });

  it("ensureDeliverableTsconfig creates tsconfig", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    try {
      const outputDir = path.join(tempRoot, "out");
      await mkdir(outputDir, { recursive: true });
      await ensureDeliverableTsconfig(outputDir);
      const tsconfigPath = path.join(outputDir, "tsconfig.json");
      await access(tsconfigPath);
      const raw = await readFile(tsconfigPath, "utf-8");
      const cfg = JSON.parse(raw);
      expect(cfg.compilerOptions.strict).toBe(true);
      expect(cfg.compilerOptions.target).toBe("ES2020");
      expect(cfg.compilerOptions.module).toBe("commonjs");
      expect(cfg.compilerOptions.rootDir).toBe("./src");
      expect(cfg.compilerOptions.outDir).toBe("./dist");
      expect(cfg.include).toEqual(["src/**/*"]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("verifyAssemblyOutput succeeds when src/index.ts exists and produces dist/index.js", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    const outputDir = path.join(tempRoot, "verify-out");
    try {
      await mkdir(path.join(outputDir, "src"), { recursive: true });
      await writeFile(path.join(outputDir, "src", "index.ts"), "export const x = 1;\n", "utf-8");
      await ensureDeliverableTsconfig(outputDir);
    } finally {
      process.chdir(cwd);
    }
    const result = await verifyAssemblyOutput(outputDir);
    expect(result.success).toBe(true);
    const distIndexPath = path.join(outputDir, "dist", "index.js");
    await access(distIndexPath);
  });

  it("verifyAssemblyOutput fails when src/index.ts is missing and dist/index.js is not produced", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    const outputDir = path.join(tempRoot, "verify-no-index");
    try {
      await mkdir(path.join(outputDir, "src"), { recursive: true });
      await writeFile(path.join(outputDir, "src", "other.ts"), "export const y = 2;\n", "utf-8");
      await ensureDeliverableTsconfig(outputDir);
    } finally {
      process.chdir(cwd);
    }
    const result = await verifyAssemblyOutput(outputDir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/dist\/index\.js.*not produced/);
  });

  it("verifyAssemblyOutput fails when tsc fails (invalid TS)", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    const outputDir = path.join(tempRoot, "verify-bad-ts");
    try {
      await mkdir(path.join(outputDir, "src"), { recursive: true });
      await writeFile(path.join(outputDir, "src", "index.ts"), "syntax error!!!\n", "utf-8");
      await ensureDeliverableTsconfig(outputDir);
    } finally {
      process.chdir(cwd);
    }
    const result = await verifyAssemblyOutput(outputDir);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects path traversal", async () => {
    const cwd = process.cwd();
    process.chdir(tempRoot);
    try {
      const artifact = {
        fileTree: ["../evil.ts"],
        files: { "../evil.ts": "bad" },
        report: { summary: "x", aggregations: {} },
      };
      await expect(assembleDeliverable("s1", artifact)).rejects.toThrow(/path traversal|invalid path/);
    } finally {
      process.chdir(cwd);
    }
  });
});
