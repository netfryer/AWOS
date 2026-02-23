/**
 * Express server - API + static frontend.
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { registerApiRoutes } from "./routes/index.js";
import { getPersistenceDriver } from "../src/lib/persistence/driver.js";
import { loadPortfolioConfigFromDb } from "../src/lib/governance/portfolioConfig.js";
import { loadTuningConfigFromDb } from "../src/lib/observability/tuningConfig.js";
import { loadTrustTrackerFromDb } from "../src/lib/governance/trustTracker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// API routes - mount first so /api/* is never handled by static/catch-all
registerApiRoutes(app);

// Static frontend (Vite build output) - only for non-API paths
const clientDir = path.join(__dirname, "..", "client");
if (existsSync(clientDir)) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return express.static(clientDir)(req, res, next);
  });
  // SPA fallback - Express 5 requires named wildcard: /{*splat}
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDir, "index.html"));
  });
} else {
  const fallbackHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Core API</title></head>
<body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
  <h1>Core API</h1>
  <p>API is running. Frontend (Vite) not built yet.</p>
  <p><a href="/api/ops/model-hr/health">/api/ops/model-hr/health</a></p>
  <p><a href="/api/ops/model-hr/registry">/api/ops/model-hr/registry</a></p>
  <p>Run <code>npm run build:client</code> then restart the server.</p>
</body></html>`;
  app.get("/", (_req, res) => res.send(fallbackHtml));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.type("html").send(fallbackHtml);
  });
}

async function start() {
  if (getPersistenceDriver() === "db") {
    try {
      await Promise.all([
        loadPortfolioConfigFromDb(),
        loadTuningConfigFromDb(),
        loadTrustTrackerFromDb(),
      ]);
    } catch (e) {
      console.warn("[Server] Failed to load app config from DB:", e instanceof Error ? e.message : e);
    }
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}
start().catch((e) => {
  console.error("Server failed to start:", e);
  process.exit(1);
});
