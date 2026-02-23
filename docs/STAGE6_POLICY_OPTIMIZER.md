# Stage 6: Policy Optimizer

The Policy Optimizer is a **data-driven tuning recommendation system** for escalation-aware routing. It reads aggregated policy stats, evaluates whether current gates are too strict, too loose, or well-tuned, and produces structured, explainable recommendations.

**Advisory only** — the optimizer does **not** auto-apply changes. You review recommendations and manually adjust config.

## How It Works

1. **Input**: Aggregated policy stats (from `/api/stats/policy`) and current `EscalationConfig`.
2. **Logic**: Deterministic rules based on:
   - Global signals: runs count, cheapFirstRate, escalationRate, regret, economicRegret
   - **Stage 6.3**: `primaryBlockerCounts` — when cheap-first is blocked, targets the dominant blocker (savings/confidence/gap) instead of defaulting to gap
   - Task-type signals: per-taskType cheapFirstRate and escalationRate (when runs ≥ 10)
   - Difficulty signals: high-difficulty cheapFirstRate and escalationRate
3. **Output**: `PolicyOptimizerResult` with `summary`, `health`, and `recommendations[]`.

No LLM calls. Pure function: same stats + config → same recommendations.

## Health States

| Health | Meaning |
|--------|---------|
| **healthy** | Cheap-first and escalation rates in a good range, zero regret. No or minimal recommendations. |
| **conservative** | Cheap-first rate &lt; 15% with zero regret. Gates may be too strict; loosening can improve cost efficiency. |
| **aggressive** | Regret &gt; 0 and/or economic regret &gt; 0. Gates too loose; tightening recommended. |
| **unstable** | Regret and high escalation (&gt; 25%). Gates need tightening. |

## Recommendations

Each recommendation includes:

- **severity**: `info` (optional), `adjust` (recommended), `warning` (urgent)
- **scope**: `global`, `taskType`, or `difficulty`
- **target**: e.g. `"writing"` or `"high"` when scope is taskType/difficulty
- **parameter**: `cheapFirstMaxGapByDifficulty`, `cheapFirstMinConfidence`, `cheapFirstSavingsMinPct`, or `promotionMargin`
- **currentValue** / **suggestedValue**: numeric values (clamped to safe ranges)
- **rationale**: why this change is suggested
- **expectedImpact**: what the change should achieve
- **evidenceRuns** (Stage 6.2): number of runs supporting this recommendation
- **confidence** (Stage 6.2): `low` | `medium` | `high` — prevents over-tuning off small samples
  - `low`: ≤ 20 runs
  - `medium`: 21–49 runs
  - `high`: ≥ 50 runs

Suggested values are clamped:

- `cheapFirstSavingsMinPct`: 0.05–0.8
- `cheapFirstMinConfidence`: 0.1–0.9
- `cheapFirstMaxGapByDifficulty`: 0.02–0.20
- `promotionMargin`: 0.01–0.10

## Interpreting Recommendations

- **Regret &gt; 0** → Increase `cheapFirstMinConfidence`, decrease `cheapFirstMaxGapByDifficulty.high`
- **Economic regret &gt; 0** → Increase `cheapFirstSavingsMinPct`
- **Cheap-first &lt; 15% and no regret** → Use `primaryBlockerCounts` to target the dominant blocker (savings/confidence/gap); otherwise increase gap and decrease savings
- **Cheap-first &gt; 65%** → Increase `cheapFirstMinConfidence`
- **Escalation &gt; 30%** → Decrease `cheapFirstMaxGapByDifficulty.high`
- **Escalation &lt; 5% and cheap-first &gt; 40%** → Optional slight loosen of high gap (info)

## Suggested Workflow

1. **Run policy batch**: `npm run policy:eval-batch` (or equivalent)
2. **Check stats**: `GET /api/stats/policy`
3. **Check optimizer**: `GET /api/stats/policy/optimize`
4. **Manually adjust config**: Update `EscalationConfig` (e.g. in API route or env) with suggested values
5. **Re-run batch**: Validate impact of changes

## A/B Testing

Run a quick A/B to validate a gap change (e.g. high 0.10 → 0.12):

```bash
npm run policy:eval-ab
```

This runs the batch twice (baseline, then experimental with `CHEAP_FIRST_GAP_HIGH=0.12`), compares writing metrics, and prints a verdict. If escalations spike, dial back to 0.11.

To run the batch manually with a gap override:

```bash
CHEAP_FIRST_GAP_HIGH=0.12 npm run policy:eval-batch
```

## API

**GET /api/stats/policy/optimize**

Returns:

```json
{
  "stats": { ... },
  "optimizer": {
    "summary": "Policy is healthy. Cheap-first used on 26% of runs with 10% escalation and zero regret. No adjustments required.",
    "health": "healthy",
    "recommendations": []
  }
}
```

When recommendations exist:

```json
{
  "optimizer": {
    "summary": "Policy is conservative. Cheap-first rate is 8.0% with zero regret. Loosening gap and savings threshold may increase cost efficiency.",
    "health": "conservative",
    "recommendations": [
      {
        "severity": "adjust",
        "scope": "difficulty",
        "target": "medium",
        "parameter": "cheapFirstMaxGapByDifficulty",
        "currentValue": 0.08,
        "suggestedValue": 0.1,
        "rationale": "Cheap-first rate is 8.0% with zero regret. Gates may be too strict.",
        "expectedImpact": "Loosening medium-difficulty gap may increase cost efficiency.",
        "evidenceRuns": 30,
        "confidence": "medium"
      }
    ]
  }
}
```
