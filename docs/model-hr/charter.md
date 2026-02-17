# Model HR Charter & Contracts

**Version:** 1.0  
**Last updated:** 2026-02

Model HR is the canonical subsystem for model registry, policy, evaluation, and recruiting. This charter formalizes responsibilities, invariants, interfaces, data formats, and operational SLOs.

---

## 1. Responsibilities and Non-Responsibilities

### 1.1 Registry

**Responsibilities:**
- Store and retrieve `ModelRegistryEntry` (models.json)
- Store observations per model (observations/{modelId}.json)
- Store priors per model (priors/{modelId}.json)
- Provide `StorageAdapter` interface for Policy, Evaluation, Scoring
- Load/save models, observations, priors; handle ENOENT as empty

**Non-responsibilities:**
- Eligibility decisions (Policy)
- Prior computation from observations (Evaluation)
- Score computation (Scoring)
- Provider sync or onboarding (Recruiting)

### 1.2 Policy

**Responsibilities:**
- Deterministic eligibility: `isEligible(model, ctx)` → `EligibilityResult`
- `listEligibleModels(ctx)` → eligible + ineligible with reasons
- Apply governance rules: status, killSwitch, allowedTiers, blockedProviders, blockedTaskTypes, budget, importance, restrictedUseCases

**Non-responsibilities:**
- Model CRUD (Registry)
- Prior/observation storage (Registry/Evaluation)
- Scoring or ranking (Scoring)
- Provider model normalization (Recruiting)

### 1.3 Evaluation

**Responsibilities:**
- `recordObservation(obs)` → append to storage
- `updatePriorsForObservation(obs)` → compute priors from observations, save
- Auto probation/disable logic: quality prior, cost variance ratio, sample thresholds
- Emit `ModelHrSignal` on status changes (probation, disable)

**Non-responsibilities:**
- Eligibility (Policy)
- Score computation (Scoring)
- Provider sync (Recruiting)
- Routing or fallback (execution layer)

### 1.4 Scoring

**Responsibilities:**
- `computeModelScore(model, ctx)` → score [0..1]
- `computeModelScoreWithBreakdown(model, ctx)` → score + breakdown
- `getPrior(model, taskType, difficulty)` → prior or null
- Use priors for costMultiplier, qualityPrior; apply cost penalty by tier

**Non-responsibilities:**
- Eligibility (Policy)
- Prior updates (Evaluation)
- Model CRUD (Registry)

### 1.5 Recruiting

**Responsibilities:**
- Normalize provider models → canonical `ModelRegistryEntry`
- Diff: new, pricing_changed, metadata_changed, unchanged
- Safe onboarding: new → probation + canary required
- Emit `ModelHrSignal` on create/update
- Refuse dangerous updates unless `forceActiveOverride`

**Non-responsibilities:**
- Eligibility or scoring (Policy, Scoring)
- Prior computation (Evaluation)
- Runtime routing (execution layer)

### 1.6 Runtime Registry Loader

**Responsibilities:**
- `getModelRegistryForRuntime()` → registry-first, fallback when unavailable
- Use `listModels()` when available; fall back to `FALLBACK_MODELS` when registry throws or returns empty
- Record fallback via `recordRegistryFallback(errorSummary)` for Ops visibility

**Non-responsibilities:**
- Policy, Evaluation, Scoring, Recruiting logic

---

## 1.7 Procurement Boundary (Tenant Model Access)

Procurement is the tenant-facing access layer that determines which providers/models are usable for a given tenant at runtime.

### Procurement Responsibilities
- Maintain per-tenant enablement config:
  - Provider enabled/disabled
  - Per-provider and/or global allowlist/denylist
- Determine credential availability status (presence only)
- Filter Model HR eligible candidates to tenant-allowed candidates at runtime
- Emit `PROCUREMENT_FALLBACK` when procurement filtering yields zero candidates
- Provide recommendations to humans on which new models may be worth enabling/acquiring

### Procurement Non-Responsibilities
- No model metadata source-of-truth (Model HR registry owns it)
- No eligibility policy (Model HR policy owns it)
- No scoring/ranking (Model HR scoring owns it)
- No probation/disable lifecycle (Model HR evaluation owns it)
- No secret storage (keys are env-only)

### Procurement Invariants
P1: Procurement never persists secrets (env-only credentials; files store policy/config only)
P2: Procurement failures do not crash runs (fallback + observable signal)
P3: Procurement is tenant-isolated (one tenant config cannot affect another)
P4: Procurement disqualifications are explainable in routing audit/ledger

---

## 2. Hard Invariants

The code must always satisfy these invariants. Violations are bugs.

### I1. Routing must be possible even when registry unavailable

- `resolveModelsForRouting` (runWorkPackages) uses `listEligibleModels` first; on throw or empty, falls back to `filterModelsByTier(fallbackModels, tierProfile)`.
- `getModelRegistryForRuntime` returns `FALLBACK_MODELS` when registry throws or is empty.
- Fallback must never block execution.

### I2. Storage write failures must not fail runs

- `recordObservationToModelHr` (trustTracker) catches and logs; never propagates to run.
- `emitModelHrSignal` and `recordRegistryFallback` swallow write errors (fire-and-forget).
- Callers of `recordObservation` in the execution path must use `recordObservationToModelHr` or equivalent that catches.

### I3. Deterministic modelId must never be recorded as LLM observation

- `modelId === "deterministic"` indicates shell-based QA, not an LLM. Recording it would pollute priors.
- Callers must check `modelId !== "deterministic"` before `recordObservationToModelHr`.
- Enforced at call site in runWorkPackages (worker and QA paths).

### I4. Registry fallback must be observable

- When fallback is used, `recordRegistryFallback(errorSummary)` is called.
- A `BUDGET_OPTIMIZATION` decision with `reason: "model_hr_registry_unavailable"` and optional `errorSummary` is recorded in the ledger.

### I5. Pricing mismatch is warning-only

- `predictedCostUSD` vs `pricingExpectedCostUSD` mismatch (ratio outside [0.5, 2]) is recorded in ledger and Ops UI; it must not fail the run.

### I6. Signals and fallback log never throw

- `emitModelHrSignal`, `recordRegistryFallback` use fire-and-forget; failures are swallowed.

---

## 3. Required Interfaces

### 3.1 Storage Adapter

```ts
interface StorageAdapter {
  loadModels(): Promise<ModelRegistryEntry[]>;
  saveModel(entry: ModelRegistryEntry): Promise<void>;
  saveModelReplacing?(entry: ModelRegistryEntry, oldIdToRemove: string): Promise<void>;
  loadObservations(modelId: string, limit?: number): Promise<ModelObservation[]>;
  appendObservation(obs: ModelObservation): Promise<void>;
  loadPriors(modelId: string): Promise<ModelPerformancePrior[]>;
  savePriors(modelId: string, priors: ModelPerformancePrior[]): Promise<void>;
}
```

### 3.2 Policy

```ts
listEligibleModels(ctx: EligibilityContext): Promise<{
  eligible: ModelRegistryEntry[];
  ineligible: Array<{ model: ModelRegistryEntry; result: EligibilityResult }>;
}>;
```

### 3.3 Evaluation

```ts
recordObservation(obs: ModelObservation): Promise<void>;
updatePriorsForObservation(obs: ModelObservation): Promise<ModelPerformancePrior | null>;
```

### 3.4 Scoring

```ts
computeModelScore(model: ModelRegistryEntry, ctx: ModelScoreContext): Promise<number>;
computeModelScoreWithBreakdown(model: ModelRegistryEntry, ctx: ModelScoreContext): Promise<{ score: number; breakdown: ModelScoreBreakdown }>;
getPrior(model: ModelRegistryEntry, taskType: string, difficulty: string): Promise<ModelPerformancePrior | null>;
```

### 3.5 Runtime Registry

```ts
getModelRegistryForRuntime(): Promise<{ models: ModelSpec[]; usedFallback: boolean }>;
```

### 3.6 Registry Health

```ts
recordRegistryFallback(errorSummary?: string): void;  // never throws
getRegistryFallbackCountLastHours(hours?: number): Promise<number>;
```

### 3.7 Signals

```ts
emitModelHrSignal(signal: Omit<ModelHrSignal, "tsISO">): void;  // never throws
readModelHrSignals(limit?: number): Promise<ModelHrSignal[]>;
readModelHrSignalsForModel(modelId: string, limit?: number): Promise<ModelHrSignal[]>;
```

### 3.8 Pricing

```ts
computePricingExpectedCostUSD(pricing: PricingSpec, estimatedTokens: EstimatedTokens, costMultiplier?: number): number;
detectPricingMismatch(predictedCostUSD: number, expectedCostUSD: number, threshold?: number): PricingMismatchResult;
```

### 3.9 Adapters

```ts
mapRegistryEntryToModelSpec(entry: ModelRegistryEntry): ModelSpec;
```

---

## 4. Data Retention & File Formats

Base directory: `.data/model-hr` (or `MODEL_HR_DATA_DIR`).

### 4.1 models.json

- **Format:** JSON array of `ModelRegistryEntry`
- **Retention:** Indefinite; updated by recruiting, ops API
- **Schema:** `ModelRegistryEntry[]`

### 4.2 observations/{modelId}.json

- **Format:** JSON array of `ModelObservation`, newest last
- **Retention:** Capped at 2000 per model (`OBSERVATIONS_CAP`); oldest dropped on overflow
- **Schema:** `ModelObservation[]`

### 4.3 priors/{modelId}.json

- **Format:** JSON array of `ModelPerformancePrior` per (taskType, difficulty)
- **Retention:** Indefinite; overwritten by `updatePriorsForObservation`
- **Schema:** `ModelPerformancePrior[]`

### 4.4 signals.jsonl

- **Format:** One JSON object per line (NDJSON)
- **Retention:** Append-only; no automatic truncation
- **Schema:** `ModelHrSignal` (modelId, previousStatus, newStatus, reason, sampleCount?, tsISO)

### 4.5 recruiting-report.json

- **Format:** JSON object with `created`, `updated`, `skipped` arrays
- **Retention:** Overwritten each recruiting run
- **Produced by:** Recruiting sync scripts

### 4.6 cycle-summary.json

- **Format:** JSON object with `tsISO`, `options`, `recruiting`, `canaryCount`, `rows`
- **Retention:** Overwritten each cycle run
- **Produced by:** `scripts/model-hr/cycle.ts`

### 4.7 registry-fallback.jsonl

- **Format:** One JSON object per line: `{ tsISO, errorSummary }`
- **Retention:** Append-only; no automatic truncation
- **Produced by:** `recordRegistryFallback` when registry fallback is used

### 4.8 canaries/{modelId}.jsonl

- **Format:** One JSON object per line (canary run results)
- **Retention:** Append-only per model
- **Produced by:** Canary runner

---

## 5. Operational SLOs & Failure Modes

### 5.1 Routing Latency

- **SLO:** `listEligibleModels` + `getModelRegistryForRuntime` add &lt; 500ms p99 to routing path when registry is available.
- **Mitigation:** File storage is local; no network. If slow, consider caching or async preload.

### 5.2 Cycle Runtime

- **SLO:** `model-hr:cycle` completes within 30 minutes for typical registry size (&lt; 50 models, &lt; 5 canaries).
- **Mitigation:** `--limit N` caps canary count; `--terminateOnly` / `--promoteOnly` reduce scope.

### 5.3 Canary Timeout

- **SLO:** Single canary task &lt; 60s; suite &lt; 5 min per model.
- **Mitigation:** Canary runner does not throw on single task failure; continues suite.

### 5.4 Failure Modes

| Failure | Mitigation |
|---------|------------|
| Registry file missing/corrupt | `loadModels` returns `[]` on ENOENT; `getModelRegistryForRuntime` falls back to FALLBACK_MODELS |
| Storage write fails (observations/priors) | `recordObservationToModelHr` catches and logs; run continues |
| Policy/listEligibleModels throws | `resolveModelsForRouting` catches; uses fallback models; records BUDGET_OPTIMIZATION |
| Signal/fallback log write fails | Swallowed; no run impact |
| Priors file corrupt | `loadPriors` throws on parse; caller (ScoreService) propagates; routing may use fallback if prior load fails indirectly |

---

## 6. Follow-up Engineering Work

Gaps identified that are not yet fully enforced in code:

1. **Defense-in-depth for deterministic modelId:** `recordObservation` (EvaluationService) does not reject `modelId === "deterministic"`. Add an explicit guard at the service boundary so any future caller cannot accidentally record deterministic observations.

2. **StorageAdapter write-failure contract:** The `StorageAdapter` interface does not specify that `appendObservation` may throw. Callers assume it can. Consider documenting that observation/prior writes are best-effort from the run’s perspective, or introduce a non-throwing variant used by the execution path.

3. **Cycle summary write failure:** `cycle.ts` uses `writeFile` for `cycle-summary.json`; a write failure will fail the script. Document as acceptable (script failure, not run failure) or add try/catch with fallback.

4. **Priors load failure in scoring:** If `loadPriors` throws (e.g. corrupt file), `getPrior` propagates. The scoring path is used by `computeCandidateScoresWithBreakdown` in runWorkPackages; if that throws, routing could fail. Consider catching at the scoring boundary and treating as “no prior” (costMultiplier=1).

5. **Observations cap configurability:** `OBSERVATIONS_CAP = 2000` is hardcoded in FileStorageAdapter. Consider making it configurable via env or options.
