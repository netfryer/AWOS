# Database Migration (Phase 1)

Phase 1 moves Model HR registry and fallback events to PostgreSQL.

## Quick Start

### 1. Start PostgreSQL (Docker)

```bash
docker compose up -d postgres
```

Default: `postgresql://core:core@localhost:5432/core`

### 2. Set environment

```bash
export DATABASE_URL=postgresql://core:core@localhost:5432/core
export PERSISTENCE_DRIVER=db
```

### 3. Run migrations

```bash
npm run db:migrate
```

### 4. Seed registry from existing models.json (optional)

If you have `.data/model-hr/models.json` and want to migrate it:

```bash
PERSISTENCE_DRIVER=db DATABASE_URL=postgresql://core:core@localhost:5432/core npm run db:seed-registry
```

### 5. Run the app

```bash
npm run dev:ui
```

## Tables (Phase 1)

- **model_registry** — canonical model entries (id, provider, status, payload jsonb)
- **registry_fallback_events** — when runtime fell back to FALLBACK_MODELS

## Switching back to file storage

Set `PERSISTENCE_DRIVER=file` (or unset). No DB required.
