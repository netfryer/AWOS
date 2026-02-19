# AWOS Capabilities Document

**Version:** 1.0  
**Last updated:** 2026-02

This document catalogs all capabilities, features, endpoints, interoperations, flows, and core functions of the AWOS (AI Work Orchestration System) application.

---

## 1. High-Level Capabilities

| Capability | Description |
|------------|-------------|
| **Planning** | Decompose directives into subtasks (deterministic keyword-based or LLM-assisted) |
| **Packaging** | Convert subtasks into atomic work packages with Worker/QA roles, acceptance criteria, token estimates |
| **Execution** | Run packages by routing to LLM models with tier profiles, QA checks, and budget gating |
| **Model HR** | Canonical model registry, policy, scoring, evaluation, recruiting, canary, actions, signals |
| **Procurement** | Tenant-facing provider/model enablement, credentials status, allowlist/denylist, recommendations |
| **Routing** | Model selection by expertise threshold, cost, score; portfolio-aware; procurement-filtered |
| **Governance** | Trust tracking, variance calibration, escalation policy, portfolio optimization |
| **Observability** | Run ledger, KPIs, tuning proposals, session polling |

---

## 2. Features by Domain

### 2.1 Planning & Packaging

- **Deterministic decomposition** – Keyword-based (cli, csv, parse, json, validate, etc.) → implementation subtasks
- **LLM-assisted planning** – Director model produces subtasks with taskType, difficulty, importance
- **Council audit** – Optional validation of director output
- **Budget optimization** – Allocate budget across subtasks
- **Package validation** – `validateWorkPackages` enforces structure and dependencies

### 2.2 Execution

- **Concurrent workers** – Configurable worker/QA concurrency
- **Deterministic QA** – Shell-based checks (test/lint) before LLM QA
- **LLM QA** – Second-pass review when deterministic fails or no signal
- **Budget gating** – Skip QA or reduce batch when over budget
- **Trust-weighted scoring** – Trust deltas applied to model selection
- **Variance recording** – Predicted vs actual cost/quality for calibration

### 2.3 Model HR

- **Registry** – models.json, observations, priors; file-backed storage
- **Policy** – Eligibility by status, tier, provider, task type, budget, importance
- **Scoring** – Score [0..1] from priors, reliability, cost penalty; breakdown for explainability
- **Evaluation** – Record observations; update priors; auto probation/disable
- **Recruiting** – Sync provider configs; new → probation; emit signals
- **Canary** – Suite of tasks; probation/graduate based on quality thresholds
- **Actions queue** – Approve/reject disable actions
- **Signals** – ModelHrSignal, escalation signals; append-only log

### 2.4 Procurement

- **Tenant config** – Provider enable/disable; allowlist/denylist (providers, models)
- **Credentials** – Env-only (OPENAI_API_KEY, ANTHROPIC_API_KEY); presence status
- **Filtering** – Post-policy filter; procurement_not_subscribed, credentials_missing, blocked, not_allowed
- **Recommendations** – New models from recruiting; canary graduates; enable provider

### 2.5 Governance

- **Trust tracker** – Per-model trust for worker/QA; trust deltas on run
- **Variance stats** – Calibration (cost multiplier, quality bias) per model/taskType
- **Escalation** – evaluateEscalation, applyEscalationPolicy; switch model, retry, etc.
- **Portfolio** – recommendPortfolio; prefer/lock modes; slot-based (workerCheap, workerImplementation, qaPrimary)

---

## 3. API Endpoints

### 3.1 Projects (Planning & Execution)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/projects/plan` | Directive → subtasks (estimateOnly, includeCouncilDebug) |
| POST | `/api/projects/package` | Plan → work packages |
| POST | `/api/projects/run-packages` | Execute packages (sync or async) |
| POST | `/api/projects/run-scenario` | Plan → Package → Run (full flow; async default) |
| GET | `/api/projects/run-session?id=` | Poll async run status |
| GET | `/api/projects/run-bundle?id=` | Ledger + trust + variance for run |
| GET | `/api/projects/ledger?id=` | Get ledger by runSessionId |

### 3.2 Governance

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/governance/portfolio` | Recommend portfolio (trustFloorWorker, trustFloorQa, minPredictedQuality) |
| GET | `/api/governance/portfolio-config` | Get portfolio mode (off/prefer/lock) |
| GET | `/api/governance/trust` | Get trust values per model |
| GET | `/api/governance/variance` | Get variance stats (calibration) |
| POST | `/api/governance/clarify` | Clarify directive (LLM) |

### 3.3 Observability

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/observability/runs` | List runs (limit); summarized ledgers |
| GET | `/api/observability/kpis` | Aggregate KPIs from runs |
| GET | `/api/observability/tuning/config` | Tuning config (enabled, allowAutoApply) |
| GET | `/api/observability/tuning/proposals` | Propose tuning from variance |
| POST | `/api/observability/tuning/apply` | Apply tuning proposals |

### 3.4 Model HR (Ops)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ops/model-hr/registry` | List models (includeDisabled, status, provider) |
| POST | `/api/ops/model-hr/registry` | Upsert model |
| GET | `/api/ops/model-hr/registry/[id]/status` | Get model status |
| POST | `/api/ops/model-hr/registry/[id]/status` | Set status (active, probation, etc.) |
| POST | `/api/ops/model-hr/registry/[id]/disable` | Disable model (reason) |
| GET | `/api/ops/model-hr/registry/[id]/observations` | Observations for model |
| GET | `/api/ops/model-hr/registry/[id]/priors` | Priors for model |
| GET | `/api/ops/model-hr/registry/[id]/signals` | Signals for model |
| GET | `/api/ops/model-hr/actions` | List pending actions |
| POST | `/api/ops/model-hr/actions/[id]/approve` | Approve action |
| POST | `/api/ops/model-hr/actions/[id]/reject` | Reject action |
| GET | `/api/ops/model-hr/signals` | List signals |
| GET | `/api/ops/model-hr/analytics` | Model HR analytics (windowHours) |
| GET | `/api/ops/model-hr/health` | Registry health, fallback count |

### 3.5 Procurement (Ops)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ops/procurement/status` | Provider status (enabled, credential connected/missing) |
| GET | `/api/ops/procurement/recommendations` | Recommendations for tenant |
| GET | `/api/ops/procurement/tenants/[tenantId]` | Get tenant config |
| PUT | `/api/ops/procurement/tenants/[tenantId]` | Set tenant config |

### 3.6 Other

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/project/estimate` | Estimate project (directive, budget) |
| POST | `/api/project/run` | Run project (legacy) |
| POST | `/api/run` | Run (legacy) |
| POST | `/api/force-run` | Force run |
| GET | `/api/stats` | Stats |
| GET | `/api/stats/variance` | Variance stats |
| POST | `/api/test/run` | Test run |
| GET | `/api/debug/anthropic-models` | Debug Anthropic models |

---

## 4. Ops UI Pages

| Path | Purpose |
|------|---------|
| `/ops/run` | Test JSON: Plan, Package, RunPackages, ScenarioRun; fixtures; assertions |
| `/ops/runs` | List runs; filters |
| `/ops/runs/[id]` | Run detail |
| `/ops/model-hr` | Registry, health, analytics, signals, priors, actions |
| `/ops/model-hr/actions` | Pending actions; approve/reject |
| `/ops/procurement` | Provider enable/disable; allowlist/denylist; credential status; recommendations |
| `/ops/governance` | Trust, variance, portfolio |
| `/ops/kpis` | KPIs |
| `/ops/tests` | Tests |

---

## 5. Core Flows

### 5.1 Scenario Run (End-to-End)

```
POST /api/projects/run-scenario
  → planProject (directive, budget, tierProfile)
  → packageWork (plan → packages)
  → runWorkPackages (packages, ctx)
  → [async] createRunSession, updateRunSession
  → summarizeLedger
```

### 5.2 Routing Flow

```
listEligibleModels (Policy: tier, taskType, difficulty, budget)
  → filterRegistryEntriesForTenant (Procurement: enabled, credentials, allowlist/denylist)
  → [if zero] PROCUREMENT_FALLBACK + fallback models
  → computeCandidateScoresWithBreakdown (Model HR Scoring)
  → route (task, models, portfolioOptions, routingOptions)
  → chosenModelId, routingAudit (candidates, disqualifiedReason)
```

### 5.3 Worker Execution Flow

```
resolveModelsForRouting (Policy + Procurement)
  → route (task, modelsByTier)
  → llmTextExecute (modelId, prompt)
  → recordObservationToModelHr (cost, quality)
  → trustTracker.recordTrustDelta
  → varianceStatsTracker.recordSubtaskVariance
```

### 5.4 QA Flow

```
Deterministic QA (shell) → pass/fail
  → [if fail] LLM QA (analysis task, QA model)
  → parseQaOutput (pass, qualityScore, defects)
  → recordObservationToModelHr (QA model)
  → escalate if needed (evaluateEscalation, applyEscalationPolicy)
```

### 5.5 Model HR Daily Cycle

```
model-hr:cycle
  1. Recruiting: runRecruitingSync → recruiting-report.json
  2. Canary: runCanary for selected models
  3. Termination Review: escalations/cost → probation; probation+failing → disable
  4. Promotion Review: probation + canary pass + priors → active
  5. Apply (--apply) or dry-run
  6. cycle-summary.json
```

---

## 6. Interoperations

### 6.1 Model HR ↔ Execution

- **listEligibleModels** → runWorkPackages (candidate pool)
- **mapRegistryEntryToModelSpec** → router (ModelSpec)
- **computeModelScoreWithBreakdown** → router (ranking)
- **recordObservationToModelHr** → trustTracker (post-run)
- **getModelRegistryForRuntime** → plan, run-packages, run-scenario (fallback when registry empty)

### 6.2 Procurement ↔ Execution

- **filterRegistryEntriesForTenant** → runWorkPackages (post-policy filter)
- **getTenantConfig**, **getProviderStatus** → procurementService
- **ProcurementFilterReason** → RoutingCandidateAuditEntry.disqualifiedReason

### 6.3 Governance ↔ Execution

- **getTrustTracker** → route (portfolio trust floor)
- **getVarianceStatsTracker** → runWorkPackages (calibration)
- **evaluateEscalation**, **applyEscalationPolicy** → runWorkPackages (post-QA)
- **getCachedPortfolio** → runWorkPackages (portfolioOptions)

### 6.4 Observability ↔ Execution

- **getRunLedgerStore** → runWorkPackages (recordDecision, recordCost, recordTrustDelta)
- **summarizeLedger** → run-scenario, runs API
- **createRunSession**, **updateRunSession** → run-packages, run-scenario (async)

### 6.5 Procurement ↔ Model HR

- **filterRegistryEntriesForTenant** consumes Model HR registry entries
- **getProcurementRecommendations** uses recruiting report, registry, canary, analytics

---

## 7. Ledger Decision Types

| Type | When Recorded |
|------|---------------|
| ROUTE | Model chosen for worker or QA task |
| AUDIT_PATCH | (Reserved) |
| ESCALATION | Escalation policy applied (switch model, retry, etc.) |
| BUDGET_OPTIMIZATION | Registry fallback, QA skipped, budget gating |
| MODEL_HR_SIGNAL | (Emitted by Model HR; not typically in run ledger) |
| PROCUREMENT_FALLBACK | Procurement filtering yielded zero candidates |

---

## 8. Core Functions (Library)

### 8.1 Planning

- `planProject` – Directive → plan (subtasks)
- `packageWork` – Plan → AtomicWorkPackage[]
- `validateWorkPackages` – Validate package structure
- `auditDirectorOutput` – Council audit
- `optimizePlanBudgets` – Allocate budget
- `deterministicDecomposeDirective` – Keyword-based decomposition

### 8.2 Execution

- `runWorkPackages` – Execute packages with routing, QA, ledger
- `createRunSession`, `updateRunSession`, `getRunSession` – Async session store

### 8.3 Router

- `route` – Select model for task (expertise, cost, score, portfolio)
- `estimateTokensForTask` – Token estimates from directive or base

### 8.4 Model HR

- `listModels`, `getModel`, `upsertModel`, `disableModel`, `setModelStatus`
- `listEligibleModels` – Policy eligibility
- `computeModelScore`, `computeModelScoreWithBreakdown`, `getPrior`
- `recordObservation`, `updatePriorsForObservation`
- `processProviderModel`, `processProviderModels` – Recruiting
- `runCanary`, `evaluateSuiteForStatusChange`
- `enqueueAction`, `approveAction`, `rejectAction`
- `emitModelHrSignal`, `emitEscalationSignal`, `readModelHrSignals`
- `buildModelHrAnalytics`
- `getModelRegistryForRuntime`, `recordRegistryFallback`

### 8.5 Procurement

- `getTenantConfig`, `setTenantConfig`
- `getProviderStatus` – Enabled + credential presence
- `filterRegistryEntriesForTenant` – Apply allowlist/denylist, credentials
- `getProcurementRecommendations` – Heuristics (recruiting, canary, analytics)

### 8.6 Governance

- `getTrustTracker`, `trustWeightedScore`
- `getVarianceStatsTracker`
- `evaluateEscalation`, `applyEscalationPolicy`
- `recommendPortfolio`, `getCachedPortfolio`
- `getPortfolioMode`, `setPortfolioMode`

### 8.7 Observability

- `getRunLedgerStore` – Create, record, finalize ledger
- `summarizeLedger`, `aggregateKpis`
- `proposeTuning`, tuning apply

### 8.8 LLM

- `llmTextExecute` – Text completion (OpenAI/Anthropic)
- `llmExecuteJsonStrict` – JSON extraction
- `createExecutor` – OpenAIExecutor, AnthropicExecutor, MockExecutor

---

## 9. CLI Scripts

| Script | Purpose |
|--------|---------|
| `npm run model-hr:sync` | Recruiting only; writes recruiting-report.json |
| `npm run model-hr:canary` | Run canary for model(s) |
| `npm run model-hr:cycle` | Full cycle: recruiting, canary, decisions, cycle-summary |
| `npm run seed:model-hr` | Seed registry |
| `tsx scripts/runTask.ts` | Run single task |

---

## 10. Data Storage

| Path | Content |
|------|---------|
| `.data/model-hr/models.json` | Model registry |
| `.data/model-hr/observations/{modelId}.json` | Observations |
| `.data/model-hr/priors/{modelId}.json` | Performance priors |
| `.data/model-hr/signals.jsonl` | Model HR signals |
| `.data/model-hr/recruiting-report.json` | Recruiting output |
| `.data/model-hr/cycle-summary.json` | Cycle output |
| `.data/model-hr/registry-fallback.jsonl` | Fallback log |
| `.data/model-hr/actions.jsonl` | Pending actions |
| `.data/procurement/tenants/{tenantId}.json` | Tenant procurement config |
| `config/models.{provider}.json` | Provider model configs |

---

## 11. Environment Variables

| Variable | Purpose |
|---------|---------|
| `OPENAI_API_KEY` | OpenAI credentials |
| `ANTHROPIC_API_KEY` | Anthropic credentials |
| `MODEL_HR_DATA_DIR` | Model HR data path (default: `.data/model-hr`) |
| `PROCUREMENT_DATA_DIR` | Procurement data path (default: `.data/procurement`) |
| `MODEL_HR_OBSERVATIONS_CAP` | Observations cap per model |
| `MODEL_HR_AUTO_APPLY_DISABLE` | Auto-apply disable without approval |
