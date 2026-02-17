// ─── app/ops/tests/page.tsx ──────────────────────────────────────────────────

"use client";

import { useState } from "react";
import { opsStyles } from "../styles";
import { SCENARIOS, type Scenario, type PortfolioVariant } from "../scenarios";

const POLL_INITIAL_MS = 500;
const POLL_MAX_MS = 10 * 60 * 1000;
const POLL_MAX_INTERVAL_MS = 5000;

interface VariantMetrics {
  totalUSD: number;
  qaShare: number;
  bypassRate: number;
  escalations: number;
  councilPlanningSkipped: boolean;
  avgQaQualityScore: number | null;
  runSessionId: string | null;
  bundle: unknown;
  topBypassReasons: [string, number][];
}

interface VariantResult {
  variant: PortfolioVariant;
  status: "idle" | "running" | "done" | "failed";
  error?: string;
  metrics?: VariantMetrics;
}

interface CompareResult {
  id: string;
  name: string;
  pass: boolean;
  message: string;
}

function runComparisons(results: VariantResult[]): CompareResult[] {
  const done = results.filter((r) => r.status === "done" && r.metrics);
  const off = done.find((r) => r.variant === "off");
  const prefer = done.find((r) => r.variant === "prefer");
  const lock = done.find((r) => r.variant === "lock");
  const out: CompareResult[] = [];

  if (prefer && lock && prefer.metrics && lock.metrics) {
    const lockCost = lock.metrics.totalUSD;
    const preferCost = prefer.metrics.totalUSD;
    const pass = preferCost <= 0 ? lockCost <= 0 : lockCost <= preferCost * 1.1;
    out.push({
      id: "lock-vs-prefer-cost",
      name: "lock cost ≤ prefer + 10%",
      pass,
      message: pass
        ? `lock $${lockCost.toFixed(4)} ≤ prefer $${preferCost.toFixed(4)} * 1.1`
        : `lock $${lockCost.toFixed(4)} exceeds prefer $${preferCost.toFixed(4)} by >10%. Bypass reasons: ${(lock.metrics.topBypassReasons ?? []).map(([r]) => r).join(", ") || "—"}`,
    });
  }

  if (prefer && lock && prefer.metrics && lock.metrics) {
    const pass = prefer.metrics.bypassRate <= lock.metrics.bypassRate;
    out.push({
      id: "prefer-bypass-lte-lock",
      name: "prefer bypassRate ≤ lock bypassRate",
      pass,
      message: pass
        ? `prefer ${(prefer.metrics.bypassRate * 100).toFixed(1)}% ≤ lock ${(lock.metrics.bypassRate * 100).toFixed(1)}%`
        : `prefer ${(prefer.metrics.bypassRate * 100).toFixed(1)}% > lock ${(lock.metrics.bypassRate * 100).toFixed(1)}%`,
    });
  }

  const withScores = done.filter((r) => r.metrics?.avgQaQualityScore != null);
  for (let i = 0; i < withScores.length; i++) {
    for (let j = i + 1; j < withScores.length; j++) {
      const a = withScores[i].metrics!.avgQaQualityScore!;
      const b = withScores[j].metrics!.avgQaQualityScore!;
      const drop = Math.abs(a - b);
      const pass = drop <= 0.05;
      out.push({
        id: `qa-score-${withScores[i].variant}-vs-${withScores[j].variant}`,
        name: `avgQaQualityScore drop ≤ 0.05`,
        pass,
        message: pass
          ? `${withScores[i].variant} ${a.toFixed(3)} vs ${withScores[j].variant} ${b.toFixed(3)}, drop ${drop.toFixed(3)}`
          : `${withScores[i].variant} ${a.toFixed(3)} vs ${withScores[j].variant} ${b.toFixed(3)}, drop ${drop.toFixed(3)} > 0.05`,
      });
    }
  }

  return out;
}

async function downloadBundle(runSessionId: string, variant: string) {
  const url = `/api/projects/run-bundle?id=${encodeURIComponent(runSessionId)}`;
  const res = await fetch(url);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `run-bundle-${variant}-${runSessionId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function OpsTestsPage() {
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(SCENARIOS[0] ?? null);
  const [results, setResults] = useState<VariantResult[]>([]);
  const [running, setRunning] = useState(false);

  async function runVariant(
    scenario: Scenario,
    variant: PortfolioVariant
  ): Promise<VariantMetrics | { error: string }> {
    await fetch("/api/governance/portfolio-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: variant }),
    });

    const planRes = await fetch("/api/projects/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directive: scenario.planRequest.directive,
        projectBudgetUSD: scenario.planRequest.projectBudgetUSD,
        estimateOnly: scenario.planRequest.estimateOnly,
        difficulty: scenario.planRequest.difficulty ?? "medium",
      }),
    });
    const planData = await planRes.json();
    if (!planRes.ok || !planData.plan) {
      return { error: planData?.error?.message ?? "Plan failed" };
    }

    const pkgRes = await fetch("/api/projects/package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: planData.plan,
        directive: scenario.planRequest.directive,
        includeCouncilAudit: scenario.package.includeCouncilAudit,
        tierProfile: scenario.run.tierProfile,
        projectBudgetUSD: scenario.planRequest.projectBudgetUSD,
      }),
    });
    const pkgData = await pkgRes.json();
    if (!pkgRes.ok || !pkgData.packages?.length) {
      return { error: pkgData?.error?.message ?? "Package failed" };
    }

    const runRes = await fetch("/api/projects/run-packages?async=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packages: pkgData.packages,
        projectBudgetUSD: scenario.planRequest.projectBudgetUSD,
        tierProfile: scenario.run.tierProfile,
        concurrency: scenario.run.concurrency,
      }),
    });
    const runData = await runRes.json();
    if (!runRes.ok || !runData.runSessionId) {
      return { error: runData?.error?.message ?? "Run failed" };
    }

    const sid = runData.runSessionId;
    const start = Date.now();
    let interval = POLL_INITIAL_MS;

    while (Date.now() - start < POLL_MAX_MS) {
      await new Promise((r) => setTimeout(r, interval));
      const sessionRes = await fetch(`/api/projects/run-session?id=${encodeURIComponent(sid)}`);
      const sessionData = await sessionRes.json();
      const status = sessionData.session?.status;

      if (status === "completed") {
        const partial = sessionData.session?.progress?.partialResult;
        const bundleRes = await fetch(`/api/projects/run-bundle?id=${encodeURIComponent(sid)}`);
        const bundleData = await bundleRes.json();
        const summary = bundleData.bundle?.summary;
        const costs = summary?.costs ?? {};
        const totalUSD = costs.totalUSD ?? 0;
        const qaUSD = costs.qaUSD ?? 0;
        const routing = summary?.routing ?? {};
        const governance = summary?.governance ?? {};

        let avgQaQualityScore: number | null = null;
        if (partial?.qaResults?.length) {
          const sum = partial.qaResults.reduce(
            (s: number, q: { qualityScore?: number }) => s + (q.qualityScore ?? 0),
            0
          );
          avgQaQualityScore = sum / partial.qaResults.length;
        }

        return {
          totalUSD,
          qaShare: totalUSD > 0 ? qaUSD / totalUSD : 0,
          bypassRate: routing.bypassRate ?? 0,
          escalations: governance.escalations ?? 0,
          councilPlanningSkipped: governance.councilPlanningSkipped ?? false,
          avgQaQualityScore,
          runSessionId: sid,
          bundle: bundleData.bundle,
          topBypassReasons: routing.topBypassReasons ?? [],
        };
      }
      if (status === "failed") {
        return { error: sessionData.session?.progress?.warnings?.[0] ?? "Run failed" };
      }

      interval = Math.min(interval * 1.5, POLL_MAX_INTERVAL_MS);
    }

    return { error: "Polling timeout" };
  }

  async function runScenario() {
    if (!selectedScenario) return;
    setRunning(true);
    const variants = selectedScenario.variants;
    const initial: VariantResult[] = variants.map((v) => ({
      variant: v,
      status: "idle" as const,
    }));
    setResults(initial);

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      setResults((prev) =>
        prev.map((r) => (r.variant === v ? { ...r, status: "running" as const } : r))
      );
      const outcome = await runVariant(selectedScenario, v);
      setResults((prev) =>
        prev.map((r) =>
          r.variant === v
            ? "error" in outcome
              ? { ...r, status: "failed" as const, error: outcome.error }
              : { ...r, status: "done" as const, metrics: outcome }
            : r
        )
      );
    }

    setRunning(false);
  }

  const comparisons = runComparisons(results);
  const allDone = results.length > 0 && results.every((r) => r.status === "done" || r.status === "failed");

  return (
    <div style={opsStyles.spaceY}>
      <div>
        <h1 style={opsStyles.pageTitle}>Effectiveness Scenarios</h1>
        <p style={opsStyles.pageSubtitle}>
          A/B variant testing: compare off / prefer / lock portfolio modes
        </p>
      </div>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Scenario</div>
        <div style={opsStyles.sectionBody}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
            <div>
              <label style={opsStyles.label}>Scenario</label>
              <select
                value={selectedScenario?.id ?? ""}
                onChange={(e) => {
                  const s = SCENARIOS.find((x) => x.id === e.target.value);
                  setSelectedScenario(s ?? null);
                  setResults([]);
                }}
                style={opsStyles.select}
              >
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedScenario && (
              <span style={{ fontSize: 12, color: "#64748b", maxWidth: 400 }}>
                {selectedScenario.description}
              </span>
            )}
            <button
              onClick={runScenario}
              disabled={running || !selectedScenario}
              style={{ ...opsStyles.btnPrimary, opacity: running || !selectedScenario ? 0.5 : 1 }}
            >
              {running ? "Running…" : "Run Scenario"}
            </button>
          </div>
        </div>
      </section>

      {results.length > 0 && (
        <section style={opsStyles.section}>
          <div style={opsStyles.sectionHeader}>Variant status</div>
          <div style={{ padding: 24, display: "flex", flexWrap: "wrap", gap: 16 }}>
            {results.map((r) => (
              <div
                key={r.variant}
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  minWidth: 140,
                  background:
                    r.status === "done"
                      ? "#f0fdf4"
                      : r.status === "failed"
                        ? "#fef2f2"
                        : r.status === "running"
                          ? "#fff7ed"
                          : "#f8fafc",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: "#334155", marginBottom: 4 }}>
                  {r.variant}
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {r.status === "idle" && "—"}
                  {r.status === "running" && "Running…"}
                  {r.status === "done" && "Done"}
                  {r.status === "failed" && (r.error ?? "Failed")}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section style={opsStyles.section}>
          <div style={opsStyles.sectionHeader}>Results</div>
          <div style={{ overflowX: "auto" }}>
            <table style={opsStyles.table}>
              <thead>
                <tr>
                  <th style={opsStyles.th}>Variant</th>
                  <th style={{ ...opsStyles.th, textAlign: "right" }}>Total $</th>
                  <th style={{ ...opsStyles.th, textAlign: "right" }}>QA Share</th>
                  <th style={{ ...opsStyles.th, textAlign: "right" }}>Bypass %</th>
                  <th style={{ ...opsStyles.th, textAlign: "right" }}>Escalations</th>
                  <th style={opsStyles.th}>Council skipped</th>
                  <th style={{ ...opsStyles.th, textAlign: "right" }}>Avg QA score</th>
                  <th style={opsStyles.th}>Download</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.variant}>
                    <td style={opsStyles.td}>{r.variant}</td>
                    {r.metrics ? (
                      <>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          ${r.metrics.totalUSD.toFixed(4)}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {(r.metrics.qaShare * 100).toFixed(1)}%
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {(r.metrics.bypassRate * 100).toFixed(1)}%
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right" }}>
                          {r.metrics.escalations}
                        </td>
                        <td style={opsStyles.td}>
                          {r.metrics.councilPlanningSkipped ? "Yes" : "—"}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {r.metrics.avgQaQualityScore != null
                            ? r.metrics.avgQaQualityScore.toFixed(3)
                            : "—"}
                        </td>
                        <td style={opsStyles.td}>
                          {r.metrics.runSessionId && (
                            <button
                              type="button"
                              onClick={() => downloadBundle(r.metrics!.runSessionId!, r.variant)}
                              style={opsStyles.btnSecondary}
                            >
                              Bundle
                            </button>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={7} style={{ ...opsStyles.td, color: "#64748b" }}>
                        {r.status === "failed" ? r.error : r.status}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {allDone && comparisons.length > 0 && (
        <section style={opsStyles.section}>
          <div style={opsStyles.sectionHeader}>Comparisons</div>
          <div style={{ padding: 24 }}>
            <div
              style={{
                display: "inline-block",
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 16,
                background: comparisons.every((c) => c.pass) ? "#e8f5e9" : "#ffebee",
                color: comparisons.every((c) => c.pass) ? "#2e7d32" : "#c62828",
              }}
            >
              {comparisons.every((c) => c.pass) ? "PASS" : "FAIL"}
            </div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {comparisons.map((c) => (
                <li
                  key={c.id}
                  style={{
                    marginBottom: 8,
                    fontSize: 13,
                    color: c.pass ? "#334155" : "#c62828",
                  }}
                >
                  <strong>{c.name}:</strong> {c.message}
                  {c.pass ? " ✓" : " ✗"}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
