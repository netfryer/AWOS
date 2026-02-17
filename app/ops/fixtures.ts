// ─── app/ops/fixtures.ts ────────────────────────────────────────────────────
// Saved payloads for Test JSON. One fixture per mode.

export interface Fixture {
  name: string;
  description: string;
  payload: unknown;
}

export const PLAN_FIXTURES: Fixture[] = [
  {
    name: "CLI CSV tool",
    description: "Standard directive, $5 budget, medium difficulty",
    payload: {
      directive: "Build a CLI tool that parses CSV files and outputs JSON statistics",
      projectBudgetUSD: 5,
      tierProfile: "standard",
      difficulty: "medium",
      estimateOnly: false,
      includeCouncilDebug: false,
    },
  },
  {
    name: "Estimate only",
    description: "Estimate mode, low difficulty, cheap tier",
    payload: {
      directive: "Write a 500-word executive strategy memo on AI transformation trends",
      projectBudgetUSD: 0.05,
      tierProfile: "cheap",
      difficulty: "low",
      estimateOnly: true,
      includeCouncilDebug: false,
    },
  },
  {
    name: "Premium high",
    description: "Premium tier, high difficulty, $10 budget",
    payload: {
      directive: "Design a microservices architecture for an e-commerce platform with inventory, orders, and payments",
      projectBudgetUSD: 10,
      tierProfile: "premium",
      difficulty: "high",
      estimateOnly: false,
      includeCouncilDebug: false,
    },
  },
  {
    name: "Minimal directive",
    description: "Short directive, small budget",
    payload: {
      directive: "Create a hello world script",
      projectBudgetUSD: 0.5,
      tierProfile: "cheap",
      difficulty: "low",
      estimateOnly: false,
      includeCouncilDebug: false,
    },
  },
  {
    name: "Council debug",
    description: "Include council debug output",
    payload: {
      directive: "Implement a REST API for user authentication",
      projectBudgetUSD: 3,
      tierProfile: "standard",
      difficulty: "medium",
      estimateOnly: false,
      includeCouncilDebug: true,
    },
  },
];

const MINIMAL_PLAN = {
  id: "p1",
  objective: "Build a CLI tool that parses CSV files",
  workPackages: [
    {
      id: "wp1",
      name: "CSV Parser",
      description: "Parse CSV files",
      ownerRole: "owner" as const,
      deliverables: ["parser module"],
      dependencies: [],
      estimatedHours: 2,
    },
    {
      id: "wp2",
      name: "JSON Output",
      description: "Output JSON statistics",
      ownerRole: "contributor" as const,
      deliverables: ["stats formatter"],
      dependencies: ["wp1"],
      estimatedHours: 1,
    },
  ],
  risks: [],
};

export const PACKAGE_FIXTURES: Fixture[] = [
  {
    name: "Minimal plan",
    description: "Two work packages, no audit",
    payload: {
      plan: MINIMAL_PLAN,
      directive: "Build a CLI tool that parses CSV files",
      includeCouncilAudit: false,
      tierProfile: "standard",
      projectBudgetUSD: 5,
    },
  },
  {
    name: "With council audit",
    description: "Same plan with council audit enabled",
    payload: {
      plan: MINIMAL_PLAN,
      directive: "Build a CLI tool that parses CSV files",
      includeCouncilAudit: true,
      tierProfile: "standard",
      projectBudgetUSD: 5,
    },
  },
  {
    name: "Cheap tier",
    description: "Cheap tier, low budget",
    payload: {
      plan: MINIMAL_PLAN,
      directive: "Build a CLI tool",
      includeCouncilAudit: false,
      tierProfile: "cheap",
      projectBudgetUSD: 1,
    },
  },
  {
    name: "Premium tier",
    description: "Premium tier, higher budget",
    payload: {
      plan: MINIMAL_PLAN,
      directive: "Build a CLI tool that parses CSV files and outputs JSON statistics",
      includeCouncilAudit: false,
      tierProfile: "premium",
      projectBudgetUSD: 10,
    },
  },
  {
    name: "Single package",
    description: "One work package only",
    payload: {
      plan: {
        id: "p1",
        objective: "Hello world",
        workPackages: [
          {
            id: "wp1",
            name: "Main",
            description: "Main task",
            ownerRole: "owner" as const,
            deliverables: ["output"],
            dependencies: [],
            estimatedHours: 0.5,
          },
        ],
        risks: [],
      },
      directive: "Hello world",
      includeCouncilAudit: false,
      tierProfile: "cheap",
      projectBudgetUSD: 0.5,
    },
  },
];

const MINIMAL_PACKAGES = [
  {
    id: "wp1",
    role: "Worker" as const,
    name: "CSV Parser",
    description: "Parse CSV",
    acceptanceCriteria: ["Parses valid CSV", "Handles empty input", "Returns structured data"],
    inputs: {},
    outputs: { data: "parsed rows" },
    dependencies: [],
    estimatedTokens: 500,
  },
  {
    id: "wp2",
    role: "QA" as const,
    name: "Validate",
    description: "Validate output",
    acceptanceCriteria: ["Output is valid JSON"],
    inputs: { workerOutput: "from wp1" },
    outputs: { pass: true, qualityScore: 1, defects: [] },
    dependencies: ["wp1"],
    estimatedTokens: 200,
  },
];

export const RUN_PACKAGES_FIXTURES: Fixture[] = [
  {
    name: "Minimal worker + QA",
    description: "One worker, one QA, standard tier",
    payload: {
      packages: MINIMAL_PACKAGES,
      projectBudgetUSD: 5,
      tierProfile: "standard",
      concurrency: { worker: 2, qa: 1 },
    },
  },
  {
    name: "Cheap tier",
    description: "Cheap tier, low budget",
    payload: {
      packages: MINIMAL_PACKAGES,
      projectBudgetUSD: 1,
      tierProfile: "cheap",
      concurrency: { worker: 1, qa: 1 },
    },
  },
  {
    name: "Premium tier",
    description: "Premium tier, higher budget",
    payload: {
      packages: MINIMAL_PACKAGES,
      projectBudgetUSD: 10,
      tierProfile: "premium",
      concurrency: { worker: 3, qa: 1 },
    },
  },
  {
    name: "Single worker",
    description: "One worker package only",
    payload: {
      packages: [
        {
          id: "wp1",
          role: "Worker" as const,
          name: "Main",
          description: "Main task",
          acceptanceCriteria: ["Completes", "Produces output", "Meets spec"],
          inputs: {},
          outputs: {},
          dependencies: [],
          estimatedTokens: 300,
        },
      ],
      projectBudgetUSD: 2,
      tierProfile: "standard",
      concurrency: { worker: 1, qa: 1 },
    },
  },
  {
    name: "High concurrency",
    description: "More workers and QA slots",
    payload: {
      packages: [
        ...MINIMAL_PACKAGES,
        {
          id: "wp3",
          role: "Worker" as const,
          name: "Extra",
          description: "Extra worker",
          acceptanceCriteria: ["Done", "Output valid", "Meets criteria"],
          inputs: {},
          outputs: {},
          dependencies: [],
          estimatedTokens: 400,
        },
      ],
      projectBudgetUSD: 8,
      tierProfile: "standard",
      concurrency: { worker: 5, qa: 2 },
    },
  },
];
