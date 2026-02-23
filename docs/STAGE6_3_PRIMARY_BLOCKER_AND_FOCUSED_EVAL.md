# Stage 6.3: Primary Blocker Logging + Focused Evaluation Spend

Stage 6.3 improves diagnostic clarity and reduces experiment cost for escalation-aware routing.

## Why Overlapping Rejection Counters Were Misleading

Previously, `gateRejectionCounts` tracked how many model evaluations failed at each gate (savingsPct, confidence, gap, noPromotionTarget, budget). When multiple gates had non-zero counts, it was unclear which gate was the **primary blocker** — the first gate that eliminated all remaining candidates.

Example: If writing showed `confidence: 15` and `savingsPct: 10`, you couldn't tell whether:
- Confidence was the bottleneck (candidates passed savings but failed confidence), or
- Savings was the bottleneck (candidates failed savings first, and confidence counts were from a different scenario)

## How primaryBlocker Is Computed

Gates are applied **sequentially** in this order:

1. **savingsPct** — cost ≤ normalCost × (1 − savingsMinPct)
2. **confidence** — rawConf ≥ cheapFirstMinConfidence
3. **gap** — qualified OR near threshold (gap ≤ maxGap)
4. **noPromotionTarget** — has valid promotion target (when cheapFirstOnlyWhenCanPromote)
5. **budget** — worst-case cost fits budget

After each filter:
- Record remaining candidate count in `gateProgress`
- If remaining === 0 → **primaryBlocker = current gate name**, stop

If no candidates ever passed the first gate → **primaryBlocker = "no_cheap_first_candidates"**.

## How to Interpret gateProgress

`gateProgress` shows candidate counts after each gate:

```json
{
  "initial": 3,
  "afterSavings": 2,
  "afterConfidence": 0,
  "afterGap": 0,
  "afterPromotion": 0,
  "afterBudget": 0
}
```

- **initial** = working models count
- **afterSavings** = models that pass the 30% savings threshold
- **afterConfidence** = models that also pass minConfidence
- etc.

When `primaryBlocker === "confidence"`, you see `afterSavings > 0` and `afterConfidence === 0` — candidates passed savings but failed at confidence.

## primaryBlockerCounts in /api/stats/policy

Aggregated across runs:

```json
{
  "primaryBlockerCounts": {
    "totals": {
      "confidence": 18,
      "savingsPct": 12,
      "gap": 1
    },
    "byTaskType": {
      "writing": { "confidence": 15 },
      "analysis": { "savingsPct": 8 }
    },
    "byDifficulty": {
      "high": { "confidence": 18 }
    }
  }
}
```

One run is sufficient to identify the dominant blocker for a task type.

## Focused Evaluation: Reducing Experiment Cost

**Problem**: Evaluation sample rate is uniform (e.g. 25%). We evaluate normal-choice runs and cheap-first runs at the same rate, but cheap-first runs are the ones we care most about for calibration and quality validation.

**Solution**: `evaluationMode: "focused"`

- **cheap-first used** → eval at `cheapFirstEvalRate` (default 1.0 = 100%)
- **cheap-first not used** → eval at `normalEvalRate` (default 0.25 = 25%)

No additional LLM calls. Only changes the probability of evaluation.

Config:

```ts
escalation: {
  evaluationMode: "focused",
  cheapFirstEvalRate: 1.0,
  normalEvalRate: 0.25,
}
```

## logPrimaryBlockerOnlyWhenFailed

When `logPrimaryBlockerOnlyWhenFailed: true` (default), `gateProgress` is only included in the audit when cheap-first fails. Reduces JSONL size.

## Stage 6 Optimizer Integration

The policy optimizer (`/api/stats/policy/optimize`) uses `primaryBlockerCounts` as its main evidence source for "loosen" recommendations:

- When cheap-first is never used for a task type, the optimizer checks `primaryBlockerCounts.byTaskType[taskType]`.
- If the dominant blocker is **savingsPct** → recommends lowering `cheapFirstSavingsMinPct` (not gap).
- If the dominant blocker is **confidence** → recommends lowering `cheapFirstMinConfidence` (not gap).
- If the dominant blocker is **gap** → recommends loosening `cheapFirstMaxGapByDifficulty`.

This stops the optimizer from recommending gap tweaks when the real blocker is savings or confidence.

## Suggested Workflow

1. **Run small batch** (10–20 runs) with escalation-aware routing.
2. **Check primaryBlockerCounts** in `/api/stats/policy`.
3. **Adjust only the dominant blocker** (e.g. lower `cheapFirstMinConfidence` for writing if confidence dominates).
4. **Repeat** with focused evaluation to reduce cost.

Example: If `primaryBlockerCounts.byTaskType.writing.confidence === 15` and others are 0, lower `cheapFirstMinConfidence` for writing (or add calibration runs for writing models).

## Premium Lanes

When the dominant blocker is confidence or savings and you prefer not to loosen gates, use **premium task types** to disable cheap-first for that task type entirely. See [PREMIUM_TASK_TYPES.md](./PREMIUM_TASK_TYPES.md).
