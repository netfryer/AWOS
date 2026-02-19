# Project Context (Handoff)

**Purpose**: Preserve context for continuity across sessions and model handoffs.

---

## What This Actually Is

**SOHAE — Self-Optimizing Hierarchical AI Enterprise**

Not a prompt router, cost optimizer, multi-model wrapper, or agent framework. This is an **AI organization** that mirrors how real companies function:

| Role | AI Layer |
|------|----------|
| CEO | Sets goals |
| Executives | Interpret strategy |
| Directors | Plan |
| Managers | Allocate budget |
| Workers | Execute |
| QA | Validates |
| Finance | Measures variance |
| Strategy | Adjusts |

Every role is an AI layer. That's organizational design applied to AI.

### Why This Is Different

- **Hierarchical, budget-aware, variance-tracked, calibrated, tiered, consensus-driven** — not linear single-agent
- **Enterprise economics** — ROI, budget allocation, quality prediction, variance correction, calibration; AI as capital allocation
- **Deterministic + probabilistic hybrid** — Decompose/estimate without LLM burn; execute with LLM; calibrate post-run
- **Governance as primitive** — Executive Council, tier guardrails, "no models qualify within budget" states
- **Variance feedback loop** — Predicted vs actual cost/quality; calibration multipliers; self-correcting over time

**Category**: A structural operating system for AI labor. Not agents — an AI organization.

### What This Is Not

- LangChain, AutoGPT, CrewAI
- A "multi-agent framework"
- A model router
- A workflow engine

Those are task execution tools. This is an AI organization with enterprise economics embedded.

---

## What We're Building (Technical)

An **LLM task orchestration platform** that turns high-level directives into executed work. The system:

1. **Plans** – Decomposes a directive into subtasks (deterministic keyword-based or LLM-assisted)
2. **Packages** – Converts subtasks into atomic work packages with Worker/QA roles, acceptance criteria, token estimates
3. **Runs** – Executes packages by routing to models (cheap/standard/premium tiers) with QA checks
4. **Observes** – Records costs, routing decisions, trust deltas, variance stats

**"CEO proof" test**: A directive like "Build a CLI that parses CSV, validates rows, computes revenue per customer, outputs JSON" should produce implementation subtasks (not "Draft Deliverable"), execute, and show run result + ledger.

---

## Key Flows

| Flow | Endpoint | Purpose |
|------|----------|---------|
| Plan | `/api/projects/plan` | Directive → subtasks |
| Package | `/api/projects/package` | Plan → work packages |
| Run (sync/async) | `/api/projects/run-packages` | Execute packages |
| Scenario (full) | `/api/projects/run-scenario` | Plan → Package → Run in one call |
| Run session | `/api/projects/run-session?id=` | Poll async run status |
| Run bundle | `/api/projects/run-bundle?id=` | Ledger + trust + variance |
| Observability | `/api/observability/runs` | List runs, KPIs |

---

## Critical Paths

- **`app/api/projects/run-scenario/route.ts`** – Scenario runner; must create session before returning for async runs
- **`src/lib/observability/runLedger.ts`** – Run ledger store (uses `globalThis` for singleton across Next.js bundles)
- **`src/lib/execution/runSessionStore.ts`** – Async session store (uses `globalThis`; must call `createRunSession` before returning)
- **`src/project/deterministicDecomposer.ts`** – Keyword-based decomposition; has CLI/CSV/implementation rules
- **`app/ops/run/page.tsx`** – Test JSON UI; ScenarioRunRequest, fixtures, assertions, run result display

---

## Fixes Applied (Recent)

1. **Run ledger empty** – `runLedger` store was bundled per-route; switched to `globalThis` singleton
2. **Runs page empty** – Same fix; observability now shares store with run-scenario
3. **Async run result empty** – `run-scenario` never created session; added `createRunSession({ id: runSessionId, progress })` before returning
4. **runSessionStore** – Same `globalThis` pattern for session store
5. **Planner/packager mismatch** – Added `IMPLEMENTATION_KEYWORDS` (cli, csv, parse, json, validate, etc.) to deterministic decomposer; produces implementation subtasks instead of "Draft Deliverable"
6. **estimateOnly bug** – UI was `setPlan(data)` instead of `setPlan(data.plan)` when estimate-only

---

## Fixtures (Test JSON)

- **CLI CSV full run** – `estimateOnly: false`, `async: true`, concurrency worker/qa
- **Sync run** – `estimateOnly: false`, `async: false`
- **Estimate only** – `estimateOnly: true`

---

## Build / Run

- `npm run build` – Compiles `src/` → `dist/` (for CLI/scripts; Next.js imports source directly)
- `npm run dev:ui` – `next dev -p 3000` (no pre-build required)
- API routes import from `../../../../src/...` (relative to route file; Next compiles TS on the fly)

---

## Known Gotchas

- **Next.js bundling** – API routes can get separate copies of shared modules; use `globalThis` for singletons (runLedger, runSessionStore)
- **Async scenario** – Must call `createRunSession` with pre-generated `runSessionId` before returning; `updateRunSession` only updates existing sessions
- **Deterministic decomposer** – Favors draft/writing by default; implementation keywords (cli, csv, parse, json) must score ≥2 to produce implementation subtasks

---

## Ops Console Structure

- **/ops/run** – Test JSON (Plan, Package, RunPackages, ScenarioRun), fixtures, assertions, Plan/Packages/Run tabs
- **/ops/runs** – Observability runs list, filters
- **/ops/runs/[id]** – Run detail
- **/ops/tests** – (if present)
