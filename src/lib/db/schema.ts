/**
 * Drizzle schema for Model HR and run persistence.
 * Phase 1: model_registry, registry_fallback_events
 * Phase 2: run_ledgers, demo_runs, procurement, model_hr, config, trust
 */

import { pgTable, text, timestamp, jsonb, serial, real } from "drizzle-orm/pg-core";

/** Model registry: canonical model entries. Full payload in jsonb for flexibility. */
export const modelRegistry = pgTable("model_registry", {
  modelId: text("model_id").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Registry fallback events: when runtime fell back to FALLBACK_MODELS. */
export const registryFallbackEvents = pgTable("registry_fallback_events", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  reason: text("reason"),
  details: jsonb("details"),
});

/** Run ledgers for observability. */
export const runLedgers = pgTable("run_ledgers", {
  runSessionId: text("run_session_id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  meta: jsonb("meta"),
  counts: jsonb("counts").notNull(),
  costs: jsonb("costs").notNull(),
  trustDeltas: jsonb("trust_deltas").notNull(),
  variance: jsonb("variance").notNull(),
  decisions: jsonb("decisions").notNull(),
  roleExecutions: jsonb("role_executions"),
});

/** Demo runs. */
export const demoRuns = pgTable("demo_runs", {
  runSessionId: text("run_session_id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Procurement tenant configs. */
export const procurementTenantConfigs = pgTable("procurement_tenant_configs", {
  tenantId: text("tenant_id").primaryKey(),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Model HR observations. */
export const modelObservations = pgTable("model_observations", {
  id: serial("id").primaryKey(),
  modelId: text("model_id").notNull(),
  payload: jsonb("payload").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
});

/** Model HR priors. */
export const modelPriors = pgTable("model_priors", {
  modelId: text("model_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Model HR signals. */
export const modelHrSignals = pgTable("model_hr_signals", {
  id: serial("id").primaryKey(),
  modelId: text("model_id").notNull(),
  payload: jsonb("payload").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
});

/** Model HR actions. */
export const modelHrActions = pgTable("model_hr_actions", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull(),
  payload: jsonb("payload").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
});

/** Run sessions (async execution progress). */
export const runSessions = pgTable("run_sessions", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  progress: jsonb("progress").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** App config key-value store. */
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Trust tracker. */
export const trustTracker = pgTable("trust_tracker", {
  modelId: text("model_id").primaryKey(),
  worker: real("worker").notNull(),
  qa: real("qa").notNull(),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull(),
});
