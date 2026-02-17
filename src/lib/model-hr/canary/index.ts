export type { CanaryTask, CanaryRunResult, CanarySuiteResult, Difficulty, EvaluationMethod } from "./types.js";
export { DEFAULT_CANARY_SUITE } from "./canaryTasks.js";
export { runCanary } from "./canaryRunner.js";
export { evaluateSuiteForStatusChange } from "./canaryPolicy.js";
export type { CanaryPolicyResult } from "./canaryPolicy.js";
