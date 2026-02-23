# Premium Task Types (Premium Lanes)

Premium task types are task types where **cheap-first attempt-1 routing is disabled** even when escalation-aware routing is enabled. This provides an explicit product posture: some lanes stay "premium by default" to avoid brand-risky outputs from aggressive cost optimization.

## What It Is

`premiumTaskTypes: TaskType[]` is a `RouterConfig` knob. When a task's `taskType` is in this list:

- Attempt 1 routing behaves as if `routingMode` is `"normal"` (no cheap-first path)
- The normal choice (best_value or lowest_cost_qualified) is always selected for attempt 1
- Escalation (Stage 5 promotion after eval) still works normally
- Policy evaluation still logs, but indicates `premiumLane: true` and `primaryBlocker: "premium_lane"`

## Why It Exists

Evidence from policy evaluation (e.g. writing/high) may show that cheap-first is primarily blocked by confidence or savings. Rather than loosening gates and risking low-quality outputs, you can declare certain task types as **premium lanes**:

- Reduces experiment cost (no cheap-first attempts to evaluate)
- Avoids risky cheap-first behavior for brand-sensitive lanes
- Keeps calibration, selection policy, and escalation intact

## Default Behavior

- **Default**: `premiumTaskTypes: []` (no premium lanes)
- **Recommended**: `premiumTaskTypes: ["writing"]` for writing-heavy products where quality is paramount

## Interaction With Other Features

| Feature | Behavior with premium task type |
|---------|----------------------------------|
| **selectionPolicy** | Still applies. Normal choice is computed by best_value or lowest_cost_qualified. |
| **Calibration** | Still applies. Confidence and expertise are used for normal choice. |
| **Escalation** | Still applies. If eval score is below threshold, promotion to a stronger model occurs. |
| **policyEval** | Still logs. `usedCheapFirst: false`, `premiumLane: true`, `primaryBlocker: "premium_lane"`. |
| **primaryBlockerCounts** | `premium_lane` is counted separately (not `no_cheap_first_candidates`). |

## Configuration Examples

### 1. Enable globally via config

```ts
const config: RouterConfig = {
  ...DEMO_CONFIG,
  escalation: {
    policy: "promote_on_low_score",
    routingMode: "escalation_aware",
    // ...
  },
  premiumTaskTypes: ["writing"],
};
```

### 2. Override per request (API)

```json
{
  "directive": "Write a launch announcement",
  "taskType": "writing",
  "difficulty": "high",
  "premiumTaskTypesOverride": ["writing"],
  "escalationPolicyOverride": "promote_on_low_score",
  "escalationRoutingModeOverride": "escalation_aware"
}
```

This confirms cheap-first is disabled for writing even when escalation_aware is on.

### 3. Environment variable (if supported)

If your app reads config from env, you could support:

```
PREMIUM_TASK_TYPES=writing
```

(Implementation depends on your config loader.)

## Verification

### 1. Routing audit

When a premium task type is routed with escalation_aware:

- `routingAudit.escalationAware.premiumLane === true`
- `routingAudit.escalationAware.premiumLaneReason` contains the task type, e.g. `TaskType "writing" is premium; cheap-first disabled.`
- `routingAudit.escalationAware.cheapFirstChoice` is undefined
- `chosenModelId` equals `normalChoice.modelId`

### 2. Policy stats

After running a batch:

```
GET /api/stats/policy
```

Check `primaryBlockerCounts.byTaskType.writing`:

- If `premium_lane` is present, writing is correctly treated as premium
- It will not show `no_cheap_first_candidates` or gate blockers (savingsPct, confidence, etc.)

### 3. Policy eval log

Each run with a premium task type will have:

```json
{
  "policyEval": {
    "usedCheapFirst": false,
    "premiumLane": true,
    "premiumTaskType": "writing",
    "gateReason": "premium_lane",
    "primaryBlocker": "premium_lane"
  }
}
```

`gateProgress` and `gateRejectionCounts` are omitted (cheap-first was not attempted).

## API Override

Both `/api/run` and `/api/test/run` accept:

- `premiumTaskTypesOverride?: TaskType[]`

Override wins over config for that request only. Useful for experimentation without restarting the server.
