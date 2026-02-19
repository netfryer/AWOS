// ─── app/ops/scenarios.ts ──────────────────────────────────────────────────
// Effectiveness scenario definitions for A/B variant testing (off/prefer/lock).

export type PortfolioVariant = "off" | "prefer" | "lock";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** When set, uses preset packages (skips plan/package); else uses planRequest.directive */
  presetId?: string;
  planRequest: {
    directive: string;
    projectBudgetUSD: number;
    estimateOnly: boolean;
    difficulty?: "low" | "medium" | "high";
  };
  package: {
    includeCouncilAudit: boolean;
  };
  run: {
    tierProfile: "cheap" | "standard" | "premium";
    concurrency: { worker: number; qa: number };
  };
  variants: PortfolioVariant[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "cli-csv-standard",
    name: "CLI CSV tool",
    description: "Standard directive, $5 budget, medium difficulty",
    planRequest: {
      directive: "Build a CLI tool that parses CSV files and outputs JSON statistics",
      projectBudgetUSD: 5,
      estimateOnly: false,
      difficulty: "medium",
    },
    package: { includeCouncilAudit: false },
    run: { tierProfile: "standard", concurrency: { worker: 3, qa: 1 } },
    variants: ["off", "prefer", "lock"],
  },
  {
    id: "csv-json-cli-demo",
    name: "CSV → JSON Stats CLI (multi-worker preset)",
    description: "Strategy (premium) + 3 workers (cheap) parallel + aggregation + QA. Uses preset packages.",
    presetId: "csv-json-cli-demo",
    planRequest: {
      directive: "Build a CLI tool that parses CSV files and outputs JSON statistics",
      projectBudgetUSD: 8,
      estimateOnly: false,
      difficulty: "medium",
    },
    package: { includeCouncilAudit: false },
    run: { tierProfile: "standard", concurrency: { worker: 3, qa: 1 } },
    variants: ["off", "prefer", "lock"],
  },
  {
    id: "minimal-cheap",
    name: "Minimal cheap",
    description: "Short directive, $1 budget, cheap tier",
    planRequest: {
      directive: "Create a hello world script",
      projectBudgetUSD: 1,
      estimateOnly: false,
      difficulty: "low",
    },
    package: { includeCouncilAudit: false },
    run: { tierProfile: "cheap", concurrency: { worker: 2, qa: 1 } },
    variants: ["off", "prefer", "lock"],
  },
  {
    id: "strategy-premium",
    name: "Strategy premium",
    description: "Strategy directive, $8 budget, premium tier",
    planRequest: {
      directive: "Write a 500-word executive strategy memo on AI transformation trends",
      projectBudgetUSD: 8,
      estimateOnly: false,
      difficulty: "high",
    },
    package: { includeCouncilAudit: true },
    run: { tierProfile: "premium", concurrency: { worker: 4, qa: 2 } },
    variants: ["off", "prefer", "lock"],
  },
  {
    id: "api-auth-standard",
    name: "API auth",
    description: "REST API auth, $3 budget",
    planRequest: {
      directive: "Implement a REST API for user authentication with JWT",
      projectBudgetUSD: 3,
      estimateOnly: false,
      difficulty: "medium",
    },
    package: { includeCouncilAudit: false },
    run: { tierProfile: "standard", concurrency: { worker: 3, qa: 1 } },
    variants: ["off", "prefer", "lock"],
  },
  {
    id: "microservices-high",
    name: "Microservices",
    description: "Architecture design, $10 budget, high difficulty",
    planRequest: {
      directive: "Design a microservices architecture for an e-commerce platform",
      projectBudgetUSD: 10,
      estimateOnly: false,
      difficulty: "high",
    },
    package: { includeCouncilAudit: true },
    run: { tierProfile: "standard", concurrency: { worker: 5, qa: 2 } },
    variants: ["off", "prefer", "lock"],
  },
];
