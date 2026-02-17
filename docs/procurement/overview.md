# Procurement Overview

Procurement is the tenant-facing control plane for which model providers and specific models are allowed to be used at runtime.

> **Setup:** See [Procurement Setup](setup.md) for credentials, tenant config, and runtime behavior.

It solves two real problems:

1) **Not every customer subscribes to every model/provider**
   - Tenants may only have OpenAI, only Anthropic, both, or neither.
   - Even if they subscribe to a provider, they may only want a subset of models enabled.

2) **Bidirectional loop**
   - Humans tell the system what's enabled and provide credentials.
   - The system tells humans what new models are worth acquiring (recommendations).

---

## What Procurement Owns

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

---

## Data Model

### Tenant Config (file-backed, per tenant)
Stored at:
- `.data/procurement/tenants/<tenantId>.json` (default tenant: `default`)

Contains:
- Provider enable/disable flags
- Model allowlist/denylist rules per provider and/or globally

### Credentials (env-backed)
Credentials are read from environment variables only.
Example:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Procurement only reports:
- `present: true|false`
- `source: "env"`

It never stores secrets in files.

---

## Runtime Flow

At runtime (e.g., in `runWorkPackages.ts`):

1) Model HR Policy returns eligible models for the task.
2) Procurement filters those eligible models to the tenant-permitted set:
   - provider enabled?
   - credentials present?
   - allowlist/denylist rules?
3) If filtering results in **zero models**, Procurement triggers:
   - A `PROCUREMENT_FALLBACK` ledger decision
   - Router candidates include procurement disqualification reasons
   - Runtime falls back to safe minimal models (same spirit as HR fallback), or fails fast depending on the calling path.

---

## Ops UI / API

### UI
- `/ops/procurement`
  - Enable/disable providers
  - Allowlist/denylist models
  - Credential presence status
  - Recommendations view

### API (Ops)
- `GET /api/ops/procurement/status`
- `GET /api/ops/procurement/recommendations`
- `GET /api/ops/procurement/tenants/:tenantId`
- `POST /api/ops/procurement/tenants/:tenantId` (update tenant config)

---

## Recommendations

Recommendations are heuristics-based and use:
- Recruiting report (new models discovered)
- Model HR registry (pricing + metadata)
- Canary outcomes (quality gates)
- Analytics signals (fallback rate, escalation rate, cost variance)

Recommendations are advisory only:
- They never auto-enable providers/models.
- Humans decide whether to acquire/enable the model.

---

## Invariants

P1: Procurement never persists secrets (env-only credentials; files store policy/config only)
P2: Procurement failures do not crash runs (fallback + observable signal)
P3: Procurement is tenant-isolated (one tenant config cannot affect another)
P4: Procurement disqualifications are explainable in routing audit/ledger
