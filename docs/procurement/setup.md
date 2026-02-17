# Procurement Setup (Tenant Provider Enablement)

This system supports multiple model providers, but **each tenant must explicitly enable providers/models** and supply provider credentials.

### 1) Set provider credentials (env-only)

Procurement reads credentials from environment variables and never writes secrets to disk.

Examples:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

If a provider is enabled but its credential is missing, Procurement will exclude that provider at runtime and emit a `PROCUREMENT_FALLBACK` decision.

### 2) Configure tenant enablement (file-backed)

Tenant configs live at:
- `.data/procurement/tenants/<tenantId>.json`
- Default tenant: `.data/procurement/tenants/default.json`

You can edit via:
- Ops UI: `/ops/procurement`
- Or the Ops API: `/api/ops/procurement/tenants/<tenantId>`

Typical controls:
- Enable/disable providers (e.g., openai, anthropic)
- Allowlist specific models
- Denylist specific models

### 3) Runtime behavior

Routing flow:
Model HR Policy ➜ Procurement Filter ➜ Router Selection

If Procurement filtering results in no eligible candidates:
- A `PROCUREMENT_FALLBACK` decision is recorded
- Disqualification reasons are shown in the route audit
- The system degrades safely (fallback) instead of crashing
