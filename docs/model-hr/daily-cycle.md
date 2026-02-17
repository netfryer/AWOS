# Model HR Daily Cycle

**Version:** 1.0  
**Last updated:** 2026-02

This document describes the Model HR organizational loop: recruiting, evaluation, canary, decisions, reporting, and ops. It documents **existing behavior** precisely. No new features are introduced.

---

## 1. Overview

The HR loop has two modes of operation:

1. **Continuous (during runs):** Evaluation updates priors from observations as runs complete. Escalation signals are emitted when ESCALATION decisions occur.
2. **Scheduled (daily cycle):** The `model-hr:cycle` CLI orchestrates recruiting, canary, and status decisions. Run via cron or manually.

---

## 2. Step-by-Step Runbook

### Step 1: Recruiting

**Purpose:** Sync provider configs/adapters into the registry; produce recruiting report.

**CLI:** `npm run model-hr:cycle` (includes recruiting, writes recruiting-report.json) or `npm run model-hr:sync` (recruiting only, writes recruiting-report.json).

**Behavior:**
- Discovers adapters from `config/`:
  - `models.<provider>.json` → JSONConfigAdapter (local config)
  - `models.<provider>.remote.json` → RemoteStubAdapter (optional)
- For each provider, fetches models, validates with `ProviderModelSchema`, calls `processProviderModels`.
- New models → probation + canary required (safe onboarding).
- Updated models → diff (pricing_changed, metadata_changed, unchanged); emits `ModelHrSignal` on create/update.
- Output: `recruiting-report.json` (overwritten each run) with `created`, `updated`, `skipped` arrays.

**Output file:** `{MODEL_HR_DATA_DIR}/recruiting-report.json`

---

### Step 2: Evaluation (Continuous)

**Purpose:** Update priors from observations. This step does **not** run inside the cycle script; it runs during project execution.

**Trigger:** When a run completes a worker or QA task, `recordObservationToModelHr` is called (from `trustTracker`). That calls:
- `recordObservation(obs)` → appends to `observations/{modelId}.json`
- `updatePriorsForObservation(obs)` → recomputes priors for (modelId, taskType, difficulty), saves to `priors/{modelId}.json`

**Auto probation/disable (during evaluation):**
- When priors are updated, `EvaluationService.updatePriors` checks:
  - `qualityPrior < minQualityPrior` (default 0.55) or `avgCostRatio > maxCostVarianceRatio` → probation (if sampleCount ≥ 30)
  - If already probation and sampleCount ≥ 60 → disable (or enqueue action)
- Disable behavior: if `MODEL_HR_AUTO_APPLY_DISABLE=1`, applies immediately; else `enqueueAction` for ops approval.
- Emits `ModelHrSignal` on probation/disable.

**Note:** The cycle script does **not** run evaluation. Priors are updated only when runs produce observations.

---

### Step 3: Canary

**Purpose:** Run canaries for selected models to validate quality before promotion or after regression signals.

**CLI:** `npm run model-hr:cycle` (includes canary) or `npm run model-hr:canary -- --model <modelId> [--apply]` (single model).

**Selection (cycle):** A model is selected for canary if:
- `status === "probation"` OR
- Created within last `sinceDays` OR
- `evaluationMeta.canaryStatus` is `none` or `failed` OR
- Recent signal: `pricing_changed` or `metadata_changed` (within `signalDays`)

**Behavior:**
- Runs `DEFAULT_CANARY_SUITE` (8 tasks: writing, code, analysis, general).
- Each task: LLM call, JSON schema validation, quality score.
- Suite result: `avgQuality`, `failedCount`, `pass`.
- Policy: `evaluateSuiteForStatusChange(modelId, suiteResult, governance)`:
  - `failedCount >= probationFailCount` (default 2) OR `avgQuality < probationQuality` (default 0.70) → probation
  - `avgQuality >= graduateQuality` (default 0.82) AND `failedCount === 0` → active
  - Thresholds overridable via `governance.canaryThresholds`.

**Output:** Canary results per model; signals emitted only when `--apply` and status changes.

---

### Step 4: Decisions

**Purpose:** Recommend probation/active/disable. Disable requires approval unless auto-apply flag.

**Promotion (probation → active):**
- Condition: canary passes + priors meet `minQualityPrior` and `maxCostVarianceRatio`.
- With `--apply`: `setModelStatus(modelId, "active")`, emit `canary_graduate` signal.
- Without `--apply`: dry-run; `action: "promote_pending"`.

**Probation (active → probation):**
- Condition: canary regression OR termination review (escalations/cost variance).
- With `--apply`: `setModelStatus(modelId, "probation")`, emit signal.
- Termination review: `countEscalations` (canary_regression, quality_below_threshold, cost_variance_exceeded, etc.) ≥ `maxRecentEscalations` (default 2), or priors fail cost variance.

**Disable (probation → disabled):**
- Condition: probation + (priors fail quality or cost) + `!disableAutoDisable`.
- With `--apply`:
  - If `--autoApproveDisable`: `disableModel` immediately, emit signal.
  - Else: `enqueueAction(modelId, "disable", reason, "evaluation")` → ops must approve via `/ops/model-hr/actions`.

**Evaluation-service disable (during runs):**
- When `updatePriorsForObservation` detects probation + failing priors + sampleCount ≥ 60:
  - If `MODEL_HR_AUTO_APPLY_DISABLE=1`: apply immediately.
  - Else: `enqueueAction` for approval.

---

### Step 5: Reporting

**Purpose:** Write cycle-summary.json and emit signals.

**Output files:**
- `{MODEL_HR_DATA_DIR}/cycle-summary.json` — overwritten each cycle run. Contains:
  - `tsISO`, `options` (apply, limit, sinceDays, terminateOnly, promoteOnly, autoApproveDisable)
  - `recruiting`: { created, updated, skipped }
  - `canaryCount`
  - `rows`: per-model status before/after, canary metrics, action taken
- `{MODEL_HR_DATA_DIR}/signals.jsonl` — append-only. Signals emitted on status changes (probation, disable, canary_graduate, etc.).

---

### Step 6: Ops

**Purpose:** Ensure UI surfaces actions, signals, health, and analytics.

**Pages:**
- `/ops/model-hr` — Registry, health, analytics summary, filters, add/update models, model details (priors, observations, signals).
- `/ops/model-hr/actions` — Actions queue: approve/reject disable/probation/activate recommendations.

**API:**
- `GET /api/ops/model-hr/health` — Registry health (OK/FALLBACK), fallback count 24h.
- `GET /api/ops/model-hr/analytics?windowHours=24` — Aggregated metrics (registry, routing, cost, quality, escalations, models).
- `GET /api/ops/model-hr/registry` — List models.
- `GET /api/ops/model-hr/signals` — Recent signals.
- `GET /api/ops/model-hr/actions` — Pending actions.
- `POST /api/ops/model-hr/actions/[id]/approve` — Approve action.
- `POST /api/ops/model-hr/actions/[id]/reject` — Reject action.

---

## 3. CLI Reference

### model-hr:cycle

```bash
npm run model-hr:cycle
npm run model-hr:cycle -- --apply --limit 5 --sinceDays 14
npm run model-hr:cycle -- --terminateOnly --apply
npm run model-hr:cycle -- --promoteOnly --apply
npm run model-hr:cycle -- --apply --autoApproveDisable
```

| Option | Default | Description |
|--------|---------|-------------|
| `--apply` | false | Apply recommended status changes. Without it, dry-run only. |
| `--autoApproveDisable` | false | With `--apply`, auto-approve disable actions (no enqueue). |
| `--limit N` | 5 | Max models to canary per run (1–100). |
| `--sinceDays N` | 14 | Recent window for created/signals (1–90). |
| `--terminateOnly` | false | Only run termination review (probation/disable); no canaries. |
| `--promoteOnly` | false | Only run promotion actions (graduate to active). |

**Behavior:**
1. Recruiting.
2. (Unless terminateOnly) Select canary candidates, run up to `limit` canaries.
3. Promotion review: probation + canary passes + priors meet → active.
4. Termination review: escalations/cost variance → probation; probation + failing → disable.
5. Write cycle-summary.json.

### model-hr:sync

```bash
npm run model-hr:sync
```

Runs recruiting only (no canary, no decisions). Writes recruiting-report.json (same format as cycle).

### model-hr:canary

```bash
npm run model-hr:canary -- --model gpt-4o-mini
npm run model-hr:canary -- --model gpt-4o-mini --apply
```

Runs canary for a single model. With `--apply`, applies status change and emits signal.

---

## 4. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_HR_DATA_DIR` | `.data/model-hr` | Base directory for models.json, observations/, priors/, signals.jsonl, actions.jsonl, registry-fallback.jsonl, recruiting-report.json, cycle-summary.json. |
| `MODEL_HR_AUTO_APPLY_DISABLE` | (unset) | When `1` or `true`, evaluation-service auto-disables models without enqueueing. |
| `MODEL_HR_OBSERVATIONS_CAP` | 2000 | Max observations per model. |
| `MODEL_HR_PRIORS_SAMPLE_SIZE` | 100 | Last N observations for prior computation. |
| `MODEL_HR_ANALYTICS_OBSERVATION_CAP` | 5000 | Max observations for analytics. |
| `MODEL_HR_SIGNALS_RETENTION_DAYS` | 30 | Trim signals older than N days. |
| `MODEL_HR_FALLBACK_RETENTION_DAYS` | 30 | Trim registry-fallback entries older than N days. |
| `MODEL_HR_ACTIONS_RETENTION_DAYS` | 90 | Trim resolved actions older than N days. |

---

## 5. Failure Modes

| Failure | Mitigation |
|---------|------------|
| Registry file missing/corrupt | `loadModels` returns `[]`; runtime falls back to FALLBACK_MODELS. |
| Recruiting adapter fails | Error logged per provider; other providers continue. |
| Canary task fails | Single task failure does not abort suite; canary continues. |
| Canary suite throws | Cycle logs error, marks `action: "canary_error"`, continues with other models. |
| cycle-summary.json write fails | Script exits with error. Acceptable (script failure, not run failure). |
| recruiting-report.json write fails | Script exits with error. |
| Signal/fallback log write fails | Swallowed; no impact. |
| enqueueAction fails | Cycle logs `disable_enqueue_failed`, continues. |
| Ops approves/rejects | Actions queue; idempotent. |
| MODEL_HR_DATA_DIR missing | `mkdir` with `recursive: true`; fails if parent missing. |

---

## 6. Data Flow Summary

```
Runs complete
    → recordObservationToModelHr (trustTracker)
    → recordObservation + updatePriorsForObservation
    → observations appended, priors updated
    → (optional) auto probation/disable, emit signal

model-hr:cycle
    → runRecruitingSync → recruiting-report.json
    → needsCanary → runCanary (up to limit)
    → evaluateSuiteForStatusChange → promotion/probation
    → termination review (escalations, cost variance) → probation/disable
    → cycle-summary.json, signals.jsonl

Ops UI
    → /ops/model-hr (registry, health, analytics)
    → /ops/model-hr/actions (approve/reject)
```

---

## 7. Related Docs

- [Model HR Charter](./charter.md) — Responsibilities, invariants, data formats.
- [Model HR Types](../../src/lib/model-hr/types.ts) — `ModelRegistryEntry`, `ModelGovernance`, `CanaryThresholds`.
