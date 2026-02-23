/**
 * Evaluation sample rates: EVAL_MODE + explicit overrides + production safety.
 *
 * Precedence (deterministic):
 *   1. EVAL_SAMPLE_RATE_* overrides (if set)
 *   2. EVAL_MODE / BENCHMARK_MODE
 *   3. Hard defaults
 *
 * EVAL_MODE (optional): prod | benchmark | test
 *   prod     - prod=0.25, force=0.25, test=1.0 (default)
 *   benchmark- prod=1.0, force=1.0, test=1.0 (calibration, grid runs)
 *   test     - prod=0.25, force=1.0, test=1.0 (dev: test/force always eval)
 *
 * BENCHMARK_MODE=true is treated as EVAL_MODE=benchmark (backwards compat).
 *
 * Production safety: NODE_ENV=production + prodRate=1.0 + !ALLOW_FULL_EVAL_IN_PROD → force 0.25 + warn
 * BENCHMARK_MODE in production without ALLOW_FULL_EVAL_IN_PROD → loud warning, request ignored.
 */

const DEFAULT_SAMPLE_RATE_PROD = 0.25;
const DEFAULT_SAMPLE_RATE_TEST = 1.0;
const DEFAULT_SAMPLE_RATE_FORCE = 0.25;

type EvalMode = "prod" | "benchmark" | "test";

function getEvalMode(): EvalMode | null {
  const mode = process.env.EVAL_MODE?.toLowerCase();
  if (mode === "prod" || mode === "benchmark" || mode === "test") return mode;
  if (process.env.BENCHMARK_MODE === "true" || process.env.BENCHMARK_MODE === "1") {
    return "benchmark";
  }
  return null;
}

function parseRate(env: string | undefined, defaultVal: number): number {
  if (env == null || env === "") return defaultVal;
  const n = parseFloat(env);
  if (Number.isNaN(n) || n < 0 || n > 1) return defaultVal;
  return n;
}

interface ResolvedConfig {
  prod: number;
  test: number;
  force: number;
  source: string;
}

let cached: ResolvedConfig | null = null;

function resolveAll(): ResolvedConfig {
  if (cached) return cached;

  const explicitProd = process.env.EVAL_SAMPLE_RATE_PROD;
  const explicitTest = process.env.EVAL_SAMPLE_RATE_TEST;
  const explicitForce = process.env.EVAL_SAMPLE_RATE_FORCE;
  const mode = getEvalMode();
  const isProd = process.env.NODE_ENV === "production";
  const allowFullEval = process.env.ALLOW_FULL_EVAL_IN_PROD === "true" || process.env.ALLOW_FULL_EVAL_IN_PROD === "1";

  let prod: number;
  let test: number;
  let force: number;
  let source: string;

  if (
    (explicitProd != null && explicitProd !== "") ||
    (explicitTest != null && explicitTest !== "") ||
    (explicitForce != null && explicitForce !== "")
  ) {
    prod = explicitProd != null && explicitProd !== ""
      ? parseRate(explicitProd, DEFAULT_SAMPLE_RATE_PROD)
      : mode === "benchmark"
        ? 1.0
        : DEFAULT_SAMPLE_RATE_PROD;
    test = explicitTest != null && explicitTest !== ""
      ? parseRate(explicitTest, DEFAULT_SAMPLE_RATE_TEST)
      : mode === "benchmark" || mode === "test"
        ? 1.0
        : DEFAULT_SAMPLE_RATE_TEST;
    force = explicitForce != null && explicitForce !== ""
      ? parseRate(explicitForce, DEFAULT_SAMPLE_RATE_FORCE)
      : mode === "benchmark" || mode === "test"
        ? 1.0
        : DEFAULT_SAMPLE_RATE_FORCE;
    const parts: string[] = [];
    if (explicitProd != null && explicitProd !== "") parts.push("EVAL_SAMPLE_RATE_PROD");
    if (explicitTest != null && explicitTest !== "") parts.push("EVAL_SAMPLE_RATE_TEST");
    if (explicitForce != null && explicitForce !== "") parts.push("EVAL_SAMPLE_RATE_FORCE");
    source = `overrides (${parts.join(", ")})`;
  } else if (mode) {
    if (mode === "benchmark") {
      prod = 1.0;
      test = 1.0;
      force = 1.0;
      source =
        mode === "benchmark" && (process.env.BENCHMARK_MODE === "true" || process.env.BENCHMARK_MODE === "1")
          ? "BENCHMARK_MODE"
          : `EVAL_MODE=${mode}`;
    } else if (mode === "test") {
      prod = DEFAULT_SAMPLE_RATE_PROD;
      test = 1.0;
      force = 1.0;
      source = `EVAL_MODE=${mode}`;
    } else {
      prod = DEFAULT_SAMPLE_RATE_PROD;
      test = DEFAULT_SAMPLE_RATE_TEST;
      force = DEFAULT_SAMPLE_RATE_FORCE;
      source = `EVAL_MODE=${mode}`;
    }
  } else {
    prod = DEFAULT_SAMPLE_RATE_PROD;
    test = DEFAULT_SAMPLE_RATE_TEST;
    force = DEFAULT_SAMPLE_RATE_FORCE;
    source = "defaults";
  }

  if (isProd && prod === 1.0 && !allowFullEval) {
    if (mode === "benchmark" || process.env.BENCHMARK_MODE === "true" || process.env.BENCHMARK_MODE === "1") {
      console.warn(
        "[evalConfig] BENCHMARK_MODE/EVAL_MODE=benchmark ignored in production. Set ALLOW_FULL_EVAL_IN_PROD=true to enable full eval."
      );
    } else {
      console.warn(
        "[evalConfig] Production safety: prod eval rate 1.0 blocked. Set ALLOW_FULL_EVAL_IN_PROD=true to override."
      );
    }
    prod = DEFAULT_SAMPLE_RATE_PROD;
  }

  cached = { prod, test, force, source };
  console.log(`EvalConfig: ${source} prod=${prod} test=${test} force=${force}`);
  return cached;
}

/** Production runs: /api/run, runProject. Default 0.25. */
export function getEvalSampleRateProd(): number {
  return resolveAll().prod;
}

/** Test runs: /api/test/run. Default 1.0. */
export function getEvalSampleRateTest(): number {
  return resolveAll().test;
}

/** Force-run: 1.0 in benchmark/test mode, else 0.25. */
export function getEvalSampleRateForce(): number {
  return resolveAll().force;
}
