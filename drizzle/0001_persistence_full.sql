-- Phase 2: Full persistence - run ledger, demo runs, procurement, model HR, config

-- Run ledgers (observability)
CREATE TABLE IF NOT EXISTS "run_ledgers" (
  "run_session_id" text PRIMARY KEY NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "meta" jsonb,
  "counts" jsonb NOT NULL,
  "costs" jsonb NOT NULL,
  "trust_deltas" jsonb NOT NULL,
  "variance" jsonb NOT NULL,
  "decisions" jsonb NOT NULL,
  "role_executions" jsonb
);

CREATE INDEX IF NOT EXISTS "run_ledgers_started_at_idx" ON "run_ledgers" ("started_at" DESC);

-- Demo runs
CREATE TABLE IF NOT EXISTS "demo_runs" (
  "run_session_id" text PRIMARY KEY NOT NULL,
  "timestamp" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "demo_runs_timestamp_idx" ON "demo_runs" ("timestamp" DESC);

-- Procurement tenant configs
CREATE TABLE IF NOT EXISTS "procurement_tenant_configs" (
  "tenant_id" text PRIMARY KEY NOT NULL,
  "config" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Model HR observations
CREATE TABLE IF NOT EXISTS "model_observations" (
  "id" serial PRIMARY KEY NOT NULL,
  "model_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "ts" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "model_observations_model_id_ts_idx" ON "model_observations" ("model_id", "ts" DESC);

-- Model HR priors
CREATE TABLE IF NOT EXISTS "model_priors" (
  "model_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("model_id")
);

-- Model HR signals
CREATE TABLE IF NOT EXISTS "model_hr_signals" (
  "id" serial PRIMARY KEY NOT NULL,
  "model_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "ts" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "model_hr_signals_ts_idx" ON "model_hr_signals" ("ts" DESC);

-- Model HR actions
CREATE TABLE IF NOT EXISTS "model_hr_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "model_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "ts" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "model_hr_actions_ts_idx" ON "model_hr_actions" ("ts" DESC);

-- Run sessions (async execution progress)
CREATE TABLE IF NOT EXISTS "run_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "progress" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

-- App config (portfolio, tuning) - key-value store
CREATE TABLE IF NOT EXISTS "app_config" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Trust tracker (model_id -> trust by role)
CREATE TABLE IF NOT EXISTS "trust_tracker" (
  "model_id" text PRIMARY KEY NOT NULL,
  "worker" real NOT NULL,
  "qa" real NOT NULL,
  "last_updated" timestamp with time zone NOT NULL
);
