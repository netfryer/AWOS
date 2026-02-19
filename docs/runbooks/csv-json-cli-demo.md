# CSV → JSON Stats CLI Demo Runbook

## Overview

This demo demonstrates multi-worker parallelization producing a real output artifact:

- **Strategy** (premium tier): architecture, module boundaries, acceptance criteria — uses gpt-4o
- **3 workers** (cheap tier, parallel): CSV parser, stats aggregation, CLI entrypoint — use gpt-4o-mini or cheapest viable
- **Aggregation** (standard): stitches outputs into final deliverable (file tree, code blocks, README, JSON schema)
- **QA review**: deterministic checks + optional LLM QA

## How to Run from Ops Console

### 1. Ops Run page (Test JSON)

1. Navigate to **`/ops/run`**
2. Select **ScenarioRunRequest** from the JSON test mode dropdown
3. Load the **"CSV → JSON Stats CLI (preset)"** fixture from the Fixtures dropdown
4. Click **Run** (or **Run Async** for non-blocking)
5. Poll for completion; inspect plan, packages, and run result tabs

### 2. Example Request JSON (ScenarioRunRequest)

**Using preset (recommended):**

```json
{
  "presetId": "csv-json-cli-demo",
  "projectBudgetUSD": 8,
  "tierProfile": "standard",
  "concurrency": { "worker": 3, "qa": 1 },
  "async": true
}
```

**Using directive (plan → package → run):**

```json
{
  "directive": "Build a CLI tool that parses CSV files and outputs JSON statistics",
  "projectBudgetUSD": 5,
  "tierProfile": "standard",
  "difficulty": "medium",
  "estimateOnly": false,
  "includeCouncilAudit": false,
  "includeCouncilDebug": false,
  "async": true,
  "concurrency": { "worker": 3, "qa": 1 }
}
```

### 3. curl Example

```bash
curl -X POST http://localhost:3000/api/projects/run-scenario \
  -H "Content-Type: application/json" \
  -d '{
    "presetId": "csv-json-cli-demo",
    "projectBudgetUSD": 8,
    "tierProfile": "standard",
    "concurrency": { "worker": 3, "qa": 1 },
    "async": true
  }'
```

Response includes `runSessionId` for polling; use `/api/projects/run-session?id=<runSessionId>` and `/api/projects/run-bundle?id=<runSessionId>` for status and results.

## Preset Package Structure

| Package ID | Tier | Role | Description |
|------------|------|------|-------------|
| strategy | premium | Worker | Architecture + module boundaries + acceptance criteria |
| worker-1 | cheap | Worker | CSV parser implementation |
| worker-2 | cheap | Worker | Stats aggregation module |
| worker-3 | cheap | Worker | CLI entrypoint + arg parsing |
| aggregation-report | standard | Worker | Integration deliverable (file tree, code, README, JSON schema) |
| qa-review | — | QA | Deterministic + optional LLM QA |

## Deterministic QA Rules

- No placeholder text (e.g. "let's assume", "sample dataset")
- Valid JSON report with required keys: `summary`, `aggregations`
- Code blocks present for key files (when output length > 800 chars)
- Output validator runs before shell checks; failures produce defects and qualityScore 0.3

## Expected Behavior

1. **Strategy** runs first (premium → gpt-4o preferred)
2. **worker-1, worker-2, worker-3** run in parallel (cheap, cheapestViableChosen → gpt-4o-mini preferred)
3. **aggregation-report** runs after all workers complete
4. **qa-review** runs on aggregation-report output
