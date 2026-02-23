/**
 * Harness-owned tsconfig for deliverable output compilation.
 * Ensures deterministic TypeScript verification regardless of model output.
 */

// ─── src/lib/execution/deliverableTsconfig.ts ───────────────────────────────

import { mkdir, writeFile } from "fs/promises";
import path from "path";

const DELIVERABLE_TSCONFIG = {
  compilerOptions: {
    strict: true,
    noImplicitAny: false, // Lenient for model output; verify compile + module resolution
    target: "ES2020",
    module: "commonjs",
    esModuleInterop: true,
    outDir: "./dist",
    rootDir: "./src",
    skipLibCheck: true,
  },
  include: ["src/**/*"],
};

/**
 * Writes a minimal harness-owned tsconfig.json into outputDir.
 * Overwrites if present to ensure known-good config.
 */
export async function ensureDeliverableTsconfig(outputDir: string): Promise<void> {
  const absDir = path.resolve(outputDir);
  await mkdir(absDir, { recursive: true });
  const tsconfigPath = path.join(absDir, "tsconfig.json");
  await writeFile(tsconfigPath, JSON.stringify(DELIVERABLE_TSCONFIG, null, 2), "utf-8");
}
