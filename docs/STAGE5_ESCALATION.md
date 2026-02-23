# Stage 5: Automatic Escalation on Low Score

## Overview

When the evaluator score of a successful final attempt is below a target threshold, the system can automatically run an escalation attempt on a stronger model and return the better output. This is **single-hop** only (max 1 promotion).

## Configuration

- **EscalationPolicy**: `"off"` (default) | `"promote_on_low_score"`
- **minScoreByDifficulty**: `{ low: 0.7, medium: 0.8, high: 0.88 }`
- **maxPromotions**: 1
- **promotionMargin**: 0.02 — promote only if below threshold by at least this
- **scoreResolution**: 0.01 — round scores to 2 decimals before comparing (avoids twitchy borderline triggers)
- **requireEvalForDecision**: true — if eval was sampled out, run JIT evaluator when escalation is enabled
- **escalateJudgeAlways**: true — always evaluate escalated output
- **maxExtraCostUSD**: optional hard cap on incremental escalation cost

## Example JSONL Line (Two Attempts + Escalation)

```json
{
  "runId": "abc-123",
  "ts": "2025-02-14T12:00:00.000Z",
  "taskId": "task-xyz",
  "taskType": "analysis",
  "difficulty": "high",
  "routing": { "chosenModelId": "gpt-4o-mini", "status": "ok", ... },
  "attempts": [
    {
      "attempt": 1,
      "modelId": "gpt-4o-mini",
      "prompt": "User directive:\nAnalyze this complex topic...",
      "execution": { "status": "ok", "outputText": "..." },
      "validation": { "ok": true },
      "actualCostUSD": 0.0005,
      "eval": { "status": "ok", "result": { "overall": 0.72, ... } }
    },
    {
      "attempt": 2,
      "modelId": "gpt-4o",
      "prompt": "User directive:\nAnalyze this complex topic...",
      "execution": { "status": "ok", "outputText": "..." },
      "validation": { "ok": true },
      "actualCostUSD": 0.008,
      "eval": { "status": "ok", "result": { "overall": 0.91, ... } },
      "escalation": {
        "promotedFromModelId": "gpt-4o-mini",
        "promotedToModelId": "gpt-4o",
        "reason": "eval_below_threshold",
        "threshold": 0.88,
        "initialScore": 0.72,
        "chosenScore": 0.91,
        "chosenAttempt": "escalated",
        "incrementalExpectedCostUSD": 0.007,
        "incrementalActualCostUSD": 0.008
      }
    }
  ],
  "final": {
    "status": "ok",
    "chosenModelId": "gpt-4o",
    "retryUsed": false,
    "escalationUsed": true,
    "escalationDecision": {
      "initialScore": 0.72,
      "threshold": 0.88,
      "escalatedScore": 0.91,
      "chosenAttempt": "escalated",
      "reason": "eval_below_threshold"
    }
  }
}
```

## Stage 5.2: Escalation-Aware Routing (Cheap-First)

When `routingMode: "escalation_aware"` and escalation policy is on, the router may pick a cheaper model for attempt 1 (e.g. gpt-4o-mini) even when best_value would choose gpt-4o, because escalation can promote if eval is low.

**Config:** `cheapFirstMaxGapByDifficulty`, `cheapFirstMinConfidence`, `cheapFirstSavingsMinPct` (default 0.30; require candidateCost <= normalCost * (1 - pct)), `cheapFirstSavingsMinUSD` (optional secondary), `cheapFirstBudgetHeadroomFactor`, `cheapFirstOnlyWhenCanPromote`.

**Audit:** `routingAudit.escalationAware` with `normalChoice`, `cheapFirstChoice`, `reason`, `savingsUSD`.

## Smoke Test

Run a prompt likely to score below threshold on gpt-4o-mini (high/strict analysis) with escalation enabled:

```bash
# Start dev server: npm run dev:ui
# Then:
curl -X POST http://localhost:3000/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Provide a deep technical analysis of quantum entanglement with mathematical rigor.",
    "taskType": "analysis",
    "difficulty": "high",
    "profile": "strict",
    "escalationPolicyOverride": "promote_on_low_score"
  }'
```

Expected: Router picks gpt-4o-mini (or cheapest qualified). If eval < 0.88, escalation runs on gpt-4o or claude-sonnet. Final chooses the better output by eval.overall.

### Smoke Test: Escalation-Aware Routing (Stage 5.2)

```bash
curl -X POST http://localhost:3000/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Provide a deep technical analysis of quantum entanglement.",
    "taskType": "analysis",
    "difficulty": "high",
    "profile": "fast",
    "selectionPolicyOverride": "best_value",
    "escalationPolicyOverride": "promote_on_low_score",
    "escalationRoutingModeOverride": "escalation_aware"
  }'
```

Expected: Attempt 1 chooses gpt-4o-mini (cheap-first) when it is qualified/near-threshold with sufficient confidence and a promotion target exists. Response includes `routingAudit.escalationAware` with rationale.
