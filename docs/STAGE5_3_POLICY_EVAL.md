# Stage 5.3: Policy Evaluation (Shadow-Mode Metrics)

Stage 5.3 adds **shadow-mode policy evaluation** for escalation-aware routing. It measures whether cheap-first routing saves cost without harming quality—without adding any extra LLM calls.

## What Is Logged

When `escalationPolicy === "promote_on_low_score"` and `routingMode === "escalation_aware"`, each run logs a `policyEval` object on the RunLogEvent:

| Field | Description |
|-------|-------------|
| `enabled` | Always `true` when policy eval runs |
| `selectionPolicy` | `"lowest_cost_qualified"` or `"best_value"` |
| `routingMode` | `"escalation_aware"` |
| `taskType`, `difficulty`, `profile` | Task context |
| `normalChoice` | What would have been chosen without escalation-aware routing (modelId, expectedCostUSD, threshold, expertise, rawConfidence?, rationale?) |
| `chosenAttempt1` | What was actually chosen for attempt 1 (modelId, expectedCostUSD, expertise, rawConfidence?) |
| `usedCheapFirst` | Whether cheap-first was used (chosenAttempt1 differs from normalChoice) |
| `estimatedSavingsUSD`, `estimatedSavingsPct` | Estimated savings at routing time |
| `promotionTargetId?`, `worstCaseExpectedCostUSD?` | Escalation target and worst-case cost when cheap-first used |
| `gateReason?` | Why cheap-first was not used (e.g. `"rejected: no_calibration_confidence"`) |
| `result` | Post-run outcome: `escalationUsed`, `finalModelId`, `initialScore`, `finalScore`, `targetScore`, `effectiveThreshold`, `realizedAttempt1CostUSD`, `realizedTotalCostUSD` |

`normalChoice` is computed **in-memory** by re-running the router with `routingMode: "normal"`—no extra LLM calls.

## How to Interpret Stats

Call **GET /api/stats/policy** to get aggregated metrics:

### Totals

- **runs** – Number of runs with `policyEval.enabled === true`
- **usedCheapFirst** – Runs where cheap-first was used
- **cheapFirstRate** – `usedCheapFirst / runs`
- **escalations** – Runs where escalation was triggered
- **escalationRate** – `escalations / runs`
- **avgEstimatedSavingsUSD** – Average estimated savings at routing time
- **avgEstimatedSavingsPct** – Average estimated savings as a percentage
- **avgRealizedTotalCostUSD** – Average actual total cost (attempt 1 + escalation if any)
- **avgFinalScore** – Average final quality score

### By Task Type / Difficulty

Same metrics sliced by `taskType` and `difficulty` to spot patterns (e.g. cheap-first underperforming on high-difficulty tasks).

### Regret

**Regret** = cheap-first used, escalation did **not** happen, and `finalScore < targetScore`.

These are runs where we saved cost by using a cheaper model but the output did not meet the target quality. The response includes:

- **count** – Number of regret cases
- **examples** – Up to 20 most recent regret runs (runId, taskType, difficulty, modelIds, scores, costs)

Use regret to tune cheap-first gates (e.g. `cheapFirstMinConfidence`, `cheapFirstMaxGapByDifficulty`).

### Economic Regret

**Economic regret** = cheap-first used, escalation used, and `realizedTotalCostUSD > normalChoiceExpectedCostUSD`.

These are runs where attempt 1 + promotion cost more than just choosing the strong model upfront. Not “bad” per se, but indicates whether `cheapFirstSavingsMinPct` needs tightening.

## CFO-Style Interpretation

When you hit `/api/stats/policy`, focus on these five numbers first:

| Metric | Sweet spot | Too low | Too high |
|--------|------------|---------|----------|
| **cheapFirstRate** | 10–70% | <10%: gates too strict, effectively normal routing | >70%: risky; expect escalations/cost spikes |
| **escalationRate** | Low when cheapFirstRate is high | — | High: cheap-first is picking too weak models |
| **avgEstimatedSavingsPct** vs **avgRealizedTotalCostUSD** | Estimated and realized savings aligned | — | Big estimated savings but small realized: estimator off or escalations eating savings |
| **avgFinalScore** | Stable vs baseline best_value | Drops: quality suffering | — |
| **regret.count** | 0 | — | >0: “customers will complain”; inspect examples |

If regret exists, check whether escalation should have triggered (threshold/margin/rounding) or cheap-first chose a model too far below threshold (gap/conf too lax).

## Tuning Knobs (Data-Driven)

Once you have policy stats, adjust these three knobs:

| Knob | If escalationRate high | If cheapFirstRate too low |
|------|------------------------|---------------------------|
| **cheapFirstMaxGapByDifficulty** | Reduce max gap | Increase max gap slightly |
| **cheapFirstMinConfidence** | Raise minConfidence (if regret from cross-lane picks) | Lower slightly (if lanes are confident) |
| **cheapFirstSavingsMinPct** | Increase minPct (escalations erasing savings) | Decrease minPct (savings strong but cheapFirstRate low) |

## Running a Small Batch and Checking Stats

### 1. Run calibration tests (optional)

If using `best_value` or escalation-aware routing, ensure calibration data exists:

```bash
npm run runCalibrationTests
```

### 2. Run a batch of tasks with escalation-aware routing

Quick batch (30 runs: 10 code, 10 writing, 10 analysis; fast + strict profiles):

```bash
npm run policy:eval-batch
```

Or manually:

Use the API with `escalationPolicyOverride: "promote_on_low_score"` and `escalationRoutingModeOverride: "escalation_aware"`:

```bash
# Example: run 5 tasks
for i in 1 2 3 4 5; do
  curl -X POST http://localhost:3000/api/run \
    -H "Content-Type: application/json" \
    -d '{
      "message": "Analyze this data",
      "taskType": "analysis",
      "difficulty": "high",
      "escalationPolicyOverride": "promote_on_low_score",
      "escalationRoutingModeOverride": "escalation_aware"
    }'
done
```

Or use the test run endpoint:

```bash
curl -X POST http://localhost:3000/api/test/run \
  -H "Content-Type: application/json" \
  -d '{
    "directive": "Analyze this",
    "taskType": "analysis",
    "difficulty": "high",
    "profile": "fast",
    "escalationPolicyOverride": "promote_on_low_score",
    "escalationRoutingModeOverride": "escalation_aware"
  }'
```

### 3. Call the policy stats endpoint

```bash
curl http://localhost:3000/api/stats/policy
```

Example response:

```json
{
  "totals": {
    "runs": 50,
    "usedCheapFirst": 32,
    "cheapFirstRate": 0.64,
    "escalations": 8,
    "escalationRate": 0.16,
    "avgEstimatedSavingsUSD": 0.0023,
    "avgEstimatedSavingsPct": 0.45,
    "avgRealizedTotalCostUSD": 0.0031,
    "avgFinalScore": 0.87
  },
  "byTaskType": { "analysis": { ... }, "code": { ... } },
  "byDifficulty": { "low": { ... }, "medium": { ... }, "high": { ... } },
  "regret": { "count": 2, "examples": [ ... ] },
  "economicRegret": { "count": 0, "examples": [] }
}
```

Regret example entries include `runId`, `taskType`, `difficulty`, `normalChoiceModelId`, `chosenAttempt1ModelId`, `finalModelId`, `escalationUsed`, `finalScore`, `targetScore`, `realizedTotalCostUSD`, `estimatedSavingsUSD`. Economic regret examples also include `normalChoiceExpectedCostUSD`.

## Log Location

Runs are written to `./runs/runs.jsonl` (configurable via `logPath` in `runTask`). The stats endpoint reads from this file.
