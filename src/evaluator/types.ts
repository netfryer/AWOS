/**
 * Evaluator types for LLM-as-judge scoring.
 */

export interface EvalDimensions {
  correctness: number;
  completeness: number;
  clarity: number;
  safety: number;
}

export interface DimensionNotes {
  correctness: string;
  completeness: string;
  clarity: string;
  safety: string;
}

export interface EvalResult {
  overall: number;
  dimensions: EvalDimensions;
  /** Required for new evals; optional for backward compat with existing calibration data */
  dimensionNotes?: DimensionNotes;
  /** Required for new evals; optional for backward compat */
  compliance?: number;
  notes?: string;
}

export interface EvaluateInput {
  taskType: string;
  directive: string;
  outputText: string;
}

export interface EvaluateResponse {
  status: "ok" | "error";
  result?: EvalResult;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  costUSD?: number;
}

export interface Evaluator {
  evaluate(input: EvaluateInput): Promise<EvaluateResponse>;
}
