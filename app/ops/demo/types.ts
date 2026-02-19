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
