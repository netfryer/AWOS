// Shared types for Demo mode data flow.
// run-scenario API request and response types (no any).

export type DemoPresetId = "csv-json-cli-demo";

export interface DemoPreset {
  id: DemoPresetId;
  name: string;
  description: string;
  /** The directive/prompt sent to the LLM when this scenario runs. */
  directive: string;
}

export type FlowStep = "plan" | "package" | "route" | "execute" | "qa" | "ledger" | "delivery";

export type DeliveryStatus =
  | { status: "not_started" }
  | { status: "assembled"; fileCount?: number }
  | { status: "compile_verified"; fileCount?: number }
  | { status: "failed"; error: string };

/** Derives delivery status from ledger decisions (ASSEMBLY, ASSEMBLY_FAILED). */
export function selectDeliveryStatus(
  decisions: Array<{ type: string; details?: Record<string, unknown> }> | undefined
): DeliveryStatus {
  if (!decisions?.length) return { status: "not_started" };
  const failed = decisions.find((d) => d.type === "ASSEMBLY_FAILED");
  if (failed) {
    const err = failed.details?.error;
    return { status: "failed", error: typeof err === "string" ? String(err).slice(0, 120) : "Assembly failed" };
  }
  const assembly = decisions.find((d) => d.type === "ASSEMBLY");
  if (!assembly) return { status: "not_started" };
  const comp = assembly.details?.compilationSuccess;
  const fileCount = typeof assembly.details?.fileCount === "number" ? assembly.details.fileCount : undefined;
  if (comp === true) return { status: "compile_verified", fileCount };
  if (comp === false) {
    const stderr = assembly.details?.compilerStderr;
    const stdout = assembly.details?.compilerStdout;
    const err = typeof stderr === "string" ? stderr : typeof stdout === "string" ? stdout : "Compilation failed";
    return { status: "failed", error: String(err).slice(0, 120) };
  }
  return { status: "assembled", fileCount };
}

export type TierProfile = "cheap" | "standard" | "premium";

export interface RunScenarioRequest {
  presetId?: DemoPresetId;
  directive?: string;
  projectBudgetUSD: number;
  tierProfile: TierProfile;
  difficulty?: "low" | "medium" | "high";
  estimateOnly?: boolean;
  includeCouncilAudit?: boolean;
  includeCouncilDebug?: boolean;
  concurrency?: { worker?: number; qa?: number };
  async?: boolean;
}

export interface RunScenarioErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface RunResultRun {
  packageId: string;
  modelId: string;
  actualCostUSD: number;
  isEstimatedCost?: boolean;
  artifactId?: string;
  output?: string;
}

export interface RunResultQaResult {
  packageId: string;
  workerPackageId: string;
  pass: boolean;
  qualityScore: number;
  modelId?: string;
}

export interface RunResultBudget {
  startingUSD: number;
  remainingUSD: number;
}

export interface RunResult {
  runs?: RunResultRun[];
  qaResults?: RunResultQaResult[];
  escalations?: unknown[];
  budget?: RunResultBudget;
  warnings?: string[];
}

export interface RunScenarioSuccessResponse {
  success: true;
  estimateOnly?: boolean;
  plan?: unknown;
  packages?: unknown[];
  audit?: unknown;
  runSessionId?: string;
  result?: RunResult;
  bundle?: {
    ledger?: {
      costs?: Record<string, number>;
      decisions?: Array<{ type: string; details?: Record<string, unknown> }>;
    };
    [key: string]: unknown;
  };
  async?: boolean;
}

export type RunScenarioResponse = RunScenarioSuccessResponse | RunScenarioErrorResponse;

export function isRunScenarioError(r: RunScenarioResponse): r is RunScenarioErrorResponse {
  return r.success === false;
}

export interface LastDemoRun {
  timestamp: number;
  request: RunScenarioRequest;
  response: RunScenarioResponse;
}

export const LAST_DEMO_RUN_KEY = "lastDemoRun";

export interface DemoRunState {
  presetId: DemoPresetId | null;
  status: "idle" | "running" | "completed" | "failed";
  runSessionId: string | null;
  plan: unknown;
  packages: unknown[];
  result: RunResult | null;
  ledger: {
    costs?: { totalUSD?: number };
    decisions?: Array<{
      type: string;
      packageId?: string;
      details?: { chosenModelId?: string; compBreakdown?: unknown; routingCandidates?: unknown[] };
    }>;
  } | null;
  deliverable?: unknown;
}
