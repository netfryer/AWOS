-- Phase 1: Model HR registry + registry fallback events

CREATE TABLE IF NOT EXISTS "model_registry" (
  "model_id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "registry_fallback_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "ts" timestamp with time zone NOT NULL,
  "reason" text,
  "details" jsonb
);

CREATE INDEX IF NOT EXISTS "registry_fallback_events_ts_idx" ON "registry_fallback_events" ("ts");
