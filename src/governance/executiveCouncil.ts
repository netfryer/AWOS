/**
 * Executive Council orchestration: CEO directive → drafts → consensus brief.
 */

import { randomUUID } from "crypto";
import { createExecutor } from "../executor/index.js";
import { appendJsonl } from "../logger.js";
import { scoreBrief, gateDecision } from "./scoring.js";
import type {
  CeoDirectiveRequest,
  ExecutiveDraft,
  StrategyBrief,
  ExecutiveCouncilRun,
  GateDecision,
} from "./types.js";
import type { ModelSpec } from "../types.js";

const DEFAULT_GOVERNANCE_BUDGET = 0.02;
const DRAFT_INPUT_TOKENS = 2500;
const DRAFT_OUTPUT_TOKENS = 3500;
const SYNTH_INPUT_TOKENS = 5000;
const SYNTH_OUTPUT_TOKENS = 4500;

function estimateCostUSD(model: ModelSpec, input: number, output: number): number {
  return (
    (input / 1000) * model.pricing.inPer1k +
    (output / 1000) * model.pricing.outPer1k
  );
}

function resolveModel(
  models: ModelSpec[],
  preferredId: string
): ModelSpec | undefined {
  const found = models.find((m) => m.id === preferredId);
  if (found) return found;
  const tier = preferredId.includes("mini") || preferredId.includes("haiku")
    ? "cheap"
    : preferredId.includes("sonnet") || preferredId.includes("gpt-4o")
      ? "premium"
      : "mid";
  const byCost = [...models].sort(
    (a, b) =>
      a.pricing.inPer1k + a.pricing.outPer1k - (b.pricing.inPer1k + b.pricing.outPer1k)
  );
  if (tier === "cheap") return byCost[0];
  if (tier === "premium") return byCost[byCost.length - 1];
  return byCost[Math.floor(byCost.length / 2)];
}

function selectModels(
  models: ModelSpec[],
  speedPreference: "fast" | "balanced" | "thorough"
): { drafts: string[]; synthesizer: string } {
  const fast = {
    drafts: ["gpt-4o-mini", "claude-haiku-4-5-20251001"],
    synthesizer: "gpt-4o-mini",
  };
  const balanced = {
    drafts: ["gpt-4o-mini", "gpt-4o"],
    synthesizer: "gpt-4o",
  };
  const thorough = {
    drafts: ["gpt-4o", "claude-sonnet-4-5-20250929"],
    synthesizer: "claude-sonnet-4-5-20250929",
  };
  const config =
    speedPreference === "fast"
      ? fast
      : speedPreference === "thorough"
        ? thorough
        : balanced;

  const drafts: string[] = [];
  for (const id of config.drafts) {
    const m = resolveModel(models, id);
    if (m && !drafts.includes(m.id)) drafts.push(m.id);
  }
  const synth = resolveModel(models, config.synthesizer);
  return {
    drafts: drafts.length > 0 ? drafts : [models[0].id],
    synthesizer: synth?.id ?? models[0].id,
  };
}

function buildDraftPrompt(req: CeoDirectiveRequest): string {
  const ctx = [
    req.domain ? `Domain: ${req.domain}` : null,
    req.businessContext ? `Context: ${req.businessContext}` : null,
    req.timeHorizon ? `Time horizon: ${req.timeHorizon}` : null,
    req.successMetrics?.length
      ? `Success metrics: ${req.successMetrics.join(", ")}`
      : null,
    req.riskTolerance ? `Risk tolerance: ${req.riskTolerance}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are an executive council member. Produce a STRICT JSON object matching this schema. No prose.

{
  "problemStatement": "string",
  "assumptions": ["string"],
  "missingInfo": ["string"],
  "clarifyingQuestions": ["string"],
  "options": [
    {
      "id": "A"|"B"|"C",
      "name": "string",
      "summary": "string",
      "approach": ["string"],
      "pros": ["string"],
      "cons": ["string"],
      "dependencies": ["string"],
      "risks": ["string"],
      "roughCostUSD": {"low": number, "likely": number, "high": number},
      "roughTimeline": {"lowWeeks": number, "likelyWeeks": number, "highWeeks": number},
      "expectedImpact": {"metric": "string", "low": number, "likely": number, "high": number, "unit": "%"|"count"|"usd"|"time"}
    }
  ],
  "recommendedOptionId": "A"|"B"|"C",
  "confidence": number (0-1),
  "rationale": "string"
}

CEO Directive:
${req.directive}
${ctx ? `\nAdditional context:\n${ctx}` : ""}

Return ONLY valid JSON.`;
}

function buildSynthesisPrompt(
  req: CeoDirectiveRequest,
  draftTexts: string[]
): string {
  const draftsBlock = draftTexts
    .map((t, i) => `--- Draft ${i + 1} ---\n${t}`)
    .join("\n\n");

  return `You are synthesizing executive council drafts into a single StrategyBrief. Produce STRICT JSON matching this schema. No prose.

{
  "objective": "string",
  "scope": {"in": ["string"], "out": ["string"]},
  "assumptions": ["string"],
  "keyUnknowns": ["string"],
  "questionsForCEO": ["string"],
  "options": [same ExecOption schema as drafts],
  "recommendedOptionId": "A"|"B"|"C",
  "recommendedPlan": {
    "workstreams": [{"name": "string", "description": "string", "ownerRole": "string"}],
    "phases": [{"name": "string", "deliverables": ["string"], "exitCriteria": ["string"]}],
    "kpis": [{"name": "string", "target": "string", "measurement": "string"}]
  },
  "governance": {
    "decisionLog": ["string"],
    "riskRegister": [{"risk": "string", "severity": "low"|"med"|"high", "mitigation": "string"}],
    "complianceChecklist": ["string"]
  },
  "downstreamBudgetEstimateUSD": {"low": number, "likely": number, "high": number},
  "confidence": number (0-1)
}

CEO Directive:
${req.directive}

Drafts:
${draftsBlock}

Return ONLY valid JSON.`;
}

function parseJson<T>(text: string): T | undefined {
  try {
    const trimmed = text.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}") + 1;
    if (start === -1 || end <= start) return undefined;
    const json = trimmed.slice(start, end);
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export async function runExecutiveCouncil(
  request: CeoDirectiveRequest,
  models: ModelSpec[],
  logPath = "./runs/governance.jsonl"
): Promise<{
  run: ExecutiveCouncilRun;
  brief?: StrategyBrief;
  gate: GateDecision;
}> {
  const runId = randomUUID();
  const ts = new Date().toISOString();
  const governanceBudgetUSD =
    request.governanceBudgetUSD ?? DEFAULT_GOVERNANCE_BUDGET;
  const speedPreference = request.speedPreference ?? "balanced";

  let { drafts: draftIds, synthesizer: synthId } = selectModels(
    models,
    speedPreference
  );

  const draftModel = models.find((m) => m.id === draftIds[0]);
  const synthModel = models.find((m) => m.id === synthId);
  const estDraftCost =
    draftModel != null
      ? estimateCostUSD(draftModel, DRAFT_INPUT_TOKENS, DRAFT_OUTPUT_TOKENS)
      : 0.01;
  const estSynthCost =
    synthModel != null
      ? estimateCostUSD(synthModel, SYNTH_INPUT_TOKENS, SYNTH_OUTPUT_TOKENS)
      : 0.02;
  const estTotal = estDraftCost * draftIds.length + estSynthCost;

  if (estTotal > governanceBudgetUSD && draftIds.length > 1) {
    draftIds = draftIds.slice(0, 1);
  }

  const draftPrompt = buildDraftPrompt(request);
  const drafts: ExecutiveCouncilRun["drafts"] = [];

  for (const modelId of draftIds) {
    const executor = createExecutor(modelId);
    const model = models.find((m) => m.id === modelId);
    const task = {
      id: `gov-draft-${runId.slice(0, 8)}`,
      taskType: "analysis" as const,
      difficulty: "medium" as const,
    };
    const result = await executor.execute({
      task,
      modelId,
      prompt: draftPrompt,
    });

    let actualCostUSD: number | undefined;
    if (result.usage && model) {
      const inT = result.usage.inputTokens ?? 0;
      const outT = result.usage.outputTokens ?? 0;
      actualCostUSD =
        (inT / 1000) * model.pricing.inPer1k +
        (outT / 1000) * model.pricing.outPer1k;
    }

    const text = result.status === "ok" ? result.outputText ?? "" : "";
    const parsed = parseJson<ExecutiveDraft>(text);
    if (parsed) parsed.modelId = modelId;

    drafts.push({
      modelId,
      text,
      parsed: parsed as ExecutiveDraft | undefined,
      actualCostUSD,
    });
  }

  const draftTexts = drafts.map((d) => d.text).filter(Boolean);
  const synthPrompt = buildSynthesisPrompt(request, draftTexts);
  const synthExecutor = createExecutor(synthId);
  const synthModelRef = models.find((m) => m.id === synthId);
  const synthTask = {
    id: `gov-synth-${runId.slice(0, 8)}`,
    taskType: "analysis" as const,
    difficulty: "medium" as const,
  };
  const synthResult = await synthExecutor.execute({
    task: synthTask,
    modelId: synthId,
    prompt: synthPrompt,
  });

  let synthActualCostUSD: number | undefined;
  if (synthResult.usage && synthModelRef) {
    const inT = synthResult.usage.inputTokens ?? 0;
    const outT = synthResult.usage.outputTokens ?? 0;
    synthActualCostUSD =
      (inT / 1000) * synthModelRef.pricing.inPer1k +
      (outT / 1000) * synthModelRef.pricing.outPer1k;
  }

  const synthText =
    synthResult.status === "ok" ? synthResult.outputText ?? "" : "";
  const brief = parseJson<StrategyBrief>(synthText);

  const parsedDrafts = drafts
    .map((d) => d.parsed)
    .filter((p): p is ExecutiveDraft => p != null);
  const scoring = scoreBrief(brief, parsedDrafts);
  const gate = gateDecision(scoring, brief);

  const totalActualCostUSD =
    (drafts.reduce((s, d) => s + (d.actualCostUSD ?? 0), 0) ?? 0) +
    (synthActualCostUSD ?? 0);

  const run: ExecutiveCouncilRun = {
    runId,
    ts,
    request,
    governanceBudgetUSD,
    drafts,
    consensus: {
      modelId: synthId,
      text: synthText,
      parsed: brief,
      actualCostUSD: synthActualCostUSD,
    },
    scoring,
    gate,
    totalActualCostUSD,
  };

  await appendJsonl(logPath, run);

  return {
    run,
    brief,
    gate,
  };
}
