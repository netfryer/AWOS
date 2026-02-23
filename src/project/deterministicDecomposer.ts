/**
 * Deterministic keyword-based decomposition. No LLM calls.
 * Uses weighted scoring for category detection.
 */

import type { ProjectSubtask, RecommendedTier } from "./types.js";
import type { TaskType, Difficulty } from "../types.js";

const MAX_SUBTASKS = 5;

const RESEARCH_KEYWORDS: Record<string, number> = {
  analysis: 2,
  analyze: 2,
  research: 2,
  evaluate: 2,
  evaluation: 2,
  assessment: 2,
  impact: 1,
  trends: 1,
  economic: 1,
  market: 1,
  data: 1,
  study: 1,
};

const STRATEGY_KEYWORDS: Record<string, number> = {
  strategy: 2,
  strategic: 2,
  roadmap: 2,
  plan: 2,
  proposal: 2,
  recommend: 2,
  recommendations: 2,
  transformation: 1,
  initiative: 1,
  execution: 1,
};

const DRAFT_KEYWORDS: Record<string, number> = {
  memo: 2,
  report: 2,
  announcement: 2,
  summary: 2,
  draft: 2,
  write: 2,
  presentation: 1,
  executive: 1,
  board: 1,
};

const REVIEW_KEYWORDS: Record<string, number> = {
  review: 2,
  edit: 2,
  refine: 2,
  proofread: 2,
  improve: 1,
  polish: 1,
};

const IMPLEMENTATION_KEYWORDS: Record<string, number> = {
  cli: 2,
  csv: 2,
  parse: 2,
  json: 2,
  output: 1,
  validate: 2,
  "unit test": 2,
  unittest: 2,
  implement: 2,
  build: 2,
  create: 1,
  tool: 1,
};

const PHRASES: { phrase: string; category: "research" | "strategy" | "draft" | "review" | "implementation"; weight: number }[] = [
  { phrase: "strategic roadmap", category: "strategy", weight: 2 },
  { phrase: "strategic plan", category: "strategy", weight: 2 },
  { phrase: "executive summary", category: "draft", weight: 2 },
  { phrase: "executive memo", category: "draft", weight: 2 },
  { phrase: "market analysis", category: "research", weight: 2 },
  { phrase: "impact assessment", category: "research", weight: 2 },
  { phrase: "data analysis", category: "research", weight: 2 },
  { phrase: "transformation trends", category: "research", weight: 2 },
  { phrase: "ai transformation", category: "strategy", weight: 1 },
  { phrase: "review and refine", category: "review", weight: 2 },
  { phrase: "cli tool", category: "implementation", weight: 3 },
  { phrase: "parse csv", category: "implementation", weight: 3 },
  { phrase: "json output", category: "implementation", weight: 2 },
  { phrase: "json statistics", category: "implementation", weight: 2 },
];

function normalizeAndTokenize(directive: string): { normalized: string; tokens: string[] } {
  const normalized = directive
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  return { normalized, tokens };
}

function scoreCategory(
  normalized: string,
  tokens: string[],
  keywords: Record<string, number>
): number {
  let score = 0;
  for (const [keyword, weight] of Object.entries(keywords)) {
    if (tokens.includes(keyword) || normalized.includes(keyword)) {
      score += weight;
    }
  }
  return score;
}

export function deterministicDecomposeDirective(directive: string): ProjectSubtask[] {
  const { normalized, tokens } = normalizeAndTokenize(directive);

  const phraseScores: Record<string, number> = { research: 0, strategy: 0, draft: 0, review: 0, implementation: 0 };
  for (const p of PHRASES) {
    if (normalized.includes(p.phrase)) {
      phraseScores[p.category] += p.weight;
    }
  }

  const researchScore = scoreCategory(normalized, tokens, RESEARCH_KEYWORDS) + phraseScores.research;
  const strategyScore = scoreCategory(normalized, tokens, STRATEGY_KEYWORDS) + phraseScores.strategy;
  const draftScore = scoreCategory(normalized, tokens, DRAFT_KEYWORDS) + phraseScores.draft;
  const reviewScore = scoreCategory(normalized, tokens, REVIEW_KEYWORDS) + phraseScores.review;
  const implementationScore = scoreCategory(normalized, tokens, IMPLEMENTATION_KEYWORDS) + phraseScores.implementation;

  const categories: { id: string; score: number; title: string; description: string; taskType: TaskType; difficulty: Difficulty }[] = [];

  if (researchScore >= 2) {
    categories.push({
      id: "research",
      score: researchScore,
      title: "Research and Analysis",
      description: "Gather data, perform analysis, and extract key findings.",
      taskType: "analysis",
      difficulty: "medium",
    });
  }
  if (strategyScore >= 2) {
    categories.push({
      id: "strategy",
      score: strategyScore,
      title: "Strategic Recommendations",
      description: "Develop actionable recommendations and structured plan.",
      taskType: "analysis",
      difficulty: "medium",
    });
  }
  if (draftScore >= 2) {
    categories.push({
      id: "draft",
      score: draftScore,
      title: "Draft Deliverable",
      description: "Compose structured written deliverable.",
      taskType: "writing",
      difficulty: "medium",
    });
  }
  if (reviewScore >= 2) {
    categories.push({
      id: "review",
      score: reviewScore,
      title: "Review and Refinement",
      description: "Review and improve clarity, structure, and quality.",
      taskType: "writing",
      difficulty: "low",
    });
  }
  if (implementationScore >= 2) {
    categories.push({
      id: "csv-ingestion",
      score: implementationScore,
      title: "CSV ingestion + validation",
      description: "Parse CSV input, validate format, and load data.",
      taskType: "code",
      difficulty: "medium",
    });
    categories.push({
      id: "aggregation-report",
      score: implementationScore,
      title: "Aggregation + JSON report",
      description:
        "Define a JSON report schema, an aggregation algorithm, and a minimal runnable Node/TS implementation. " +
        "Output must include: (1) JSON schema for the report (summary + aggregationsSchema or exampleAggregations), " +
        "(2) input CSV interface when provided, or generic Record type for generic CSV tooling, " +
        "(3) aggregation logic description, (4) executable Node/TS code. " +
        "Do NOT invent sample data unless input data is explicitly provided. " +
        "If no input is given, output schema + example section (clearly labeled as example only).",
      taskType: "code",
      difficulty: "medium",
    });
    categories.push({
      id: "qa-review",
      score: Math.max(1, implementationScore - 1),
      title: "QA/review pass",
      description: "Validate output, run checks, and ensure quality.",
      taskType: "analysis",
      difficulty: "medium",
    });
  }

  if (categories.length === 0) {
    return [
      {
        id: "general",
        title: "Complete Task",
        description: directive,
        taskType: "general",
        difficulty: "medium",
        importance: 3,
        recommendedTier: "standard",
        allocatedBudgetUSD: 0,
      },
    ];
  }

  const subtasks = categories
    .map((c) => {
      let importance: number;
      if (c.score >= 4) importance = 5;
      else if (c.score >= 3) importance = 4;
      else importance = 3;
      importance = Math.max(1, Math.min(5, importance));

      let recommendedTier: RecommendedTier;
      if (importance >= 5) recommendedTier = "premium";
      else if (importance >= 4) recommendedTier = "standard";
      else recommendedTier = "cheap";

      return {
        id: c.id,
        title: c.title,
        description: c.description,
        taskType: c.taskType,
        difficulty: c.difficulty,
        importance,
        recommendedTier,
        allocatedBudgetUSD: 0,
      };
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, MAX_SUBTASKS);

  return subtasks as ProjectSubtask[];
}
