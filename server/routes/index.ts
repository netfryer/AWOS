/**
 * API route registration for Express.
 * Mounts all routes under /api via a dedicated router for organization.
 */

import express, { type Express } from "express";
import * as modelHr from "./modelHr.js";
import * as projects from "./projects.js";
import * as projectsExtra from "./projectsExtra.js";
import * as project from "./project.js";
import * as run from "./run.js";
import * as governance from "./governance.js";
import * as demo from "./demo.js";
import * as observability from "./observability.js";
import * as procurement from "./procurement.js";
import * as stats from "./stats.js";
import * as opsRuns from "./opsRuns.js";

export function registerApiRoutes(app: Express): void {
  const api = express.Router();

  // Model HR
  api.get("/ops/model-hr/health", modelHr.healthGet);
  api.get("/ops/model-hr/registry", modelHr.registryGet);
  api.post("/ops/model-hr/registry", modelHr.registryPost);
  api.get("/ops/model-hr/registry/:id/observations", modelHr.observationsGet);
  api.get("/ops/model-hr/registry/:id/priors", modelHr.priorsGet);
  api.get("/ops/model-hr/registry/:id/signals", modelHr.signalsGet);
  api.post("/ops/model-hr/registry/:id/status", modelHr.statusPost);
  api.post("/ops/model-hr/registry/:id/disable", modelHr.disablePost);
  api.get("/ops/model-hr/analytics", modelHr.analyticsGet);
  api.get("/ops/model-hr/actions", modelHr.actionsGet);
  api.post("/ops/model-hr/actions/:id/approve", modelHr.actionApprovePost);
  api.post("/ops/model-hr/actions/:id/reject", modelHr.actionRejectPost);
  api.get("/ops/model-hr/signals", modelHr.signalsListGet);

  // Run (chat, force-run, test)
  api.post("/run", run.runPost);
  api.post("/force-run", run.forceRunPost);
  api.post("/test/run", run.testRunPost);

  // Project (estimate, run)
  api.post("/project/estimate", project.estimatePost);
  api.post("/project/run", project.runPost);

  // Projects
  api.post("/projects/plan", projects.planPost);
  api.post("/projects/run-packages", projects.runPackagesPost);
  api.get("/projects/run-session", projects.runSessionGet);
  api.get("/projects/ledger", projects.ledgerGet);
  api.post("/projects/package", projectsExtra.packagePost);
  api.post("/projects/run-scenario", projectsExtra.runScenarioPost);
  api.get("/projects/run-bundle", projectsExtra.runBundleGet);

  // Governance
  api.get("/governance/portfolio-config", governance.portfolioConfigGet);
  api.post("/governance/portfolio-config", governance.portfolioConfigPost);
  api.get("/governance/portfolio", governance.portfolioGet);
  api.post("/governance/clarify", governance.clarifyPost);
  api.get("/governance/trust", governance.trustGet);
  api.get("/governance/variance", governance.varianceGet);

  // Demo
  api.get("/ops/demo/runs", demo.demoRunsGet);
  api.get("/ops/demo/runs/:id", demo.demoRunByIdGet);

  // Observability
  api.get("/observability/kpis", observability.kpisGet);
  api.get("/observability/tuning/proposals", observability.tuningProposalsGet);
  api.get("/observability/tuning/config", observability.tuningConfigGet);
  api.post("/observability/tuning/config", observability.tuningConfigPost);
  api.post("/observability/tuning/apply", observability.tuningApplyPost);

  // Procurement
  api.get("/ops/procurement/status", procurement.statusGet);
  api.get("/ops/procurement/recommendations", procurement.recommendationsGet);
  api.get("/ops/procurement/tenants/:tenantId", procurement.tenantsGet);
  api.put("/ops/procurement/tenants/:tenantId", procurement.tenantsPut);

  // Stats
  api.get("/stats/roles", stats.rolesGet);

  // Ops runs (deliverable)
  api.get("/ops/runs/:id/deliverable", opsRuns.deliverableGet);

  app.use("/api", api);
}
