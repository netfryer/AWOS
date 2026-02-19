// ─── app/ops/kpis/page.tsx ───────────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";

interface AggregatedKpis {
  window: number;
  totals: {
    councilUSD: number;
    workerUSD: number;
    qaUSD: number;
    deterministicQaUSD: number;
    totalUSD: number;
    packagesTotal: number;
    completed: number;
    escalations: number;
    varianceRecorded: number;
    varianceSkipped: number;
  };
  averages: {
    totalUSDPerRun: number;
    bypassRate: number;
    councilPlanningSkippedRate: number;
  };
  recommendations: string[];
}

interface RunSummary {
  runSessionId: string;
  startedAtISO: string;
  costs: { totalUSD: number };
  routing?: {
    portfolioMode?: string;
    bypassRate?: number;
    topBypassReasons?: [string, number][];
  };
  governance?: { escalations?: number };
  quality?: { deterministicPassRate?: number; avgQaQualityScore?: number };
}

interface TuningProposal {
  id: string;
  action: string;
  rationale: string;
  safeToAutoApply: boolean;
}

interface TuningConfig {
  enabled: boolean;
  allowAutoApply: boolean;
}

function parseJsonSafe(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Empty input" };
    const value = JSON.parse(trimmed);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }
}

function Card({
  title,
  value,
  sub,
}: {
  title: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div style={opsStyles.card}>
      <div style={opsStyles.label}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: "#1e293b" }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function OpsKpisPage() {
  const [kpis, setKpis] = useState<AggregatedKpis | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [proposals, setProposals] = useState<TuningProposal[]>([]);
  const [tuningConfig, setTuningConfig] = useState<TuningConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [windowSize, setWindowSize] = useState(50);
  const [jsonTestMode, setJsonTestMode] = useState<"KpisQuery" | "TuningProposalsQuery">("KpisQuery");
  const [jsonTestInput, setJsonTestInput] = useState("");
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [kRes, pRes, cRes] = await Promise.all([
        fetch(`/api/observability/kpis?window=${windowSize}`),
        fetch(`/api/observability/tuning/proposals?window=${windowSize}`),
        fetch("/api/observability/tuning/config"),
      ]);
      const kData = await kRes.json();
      const pData = await pRes.json();
      const cData = await cRes.json();
      if (!kRes.ok) throw new Error(kData?.error?.message ?? "KPIs fetch failed");
      if (!pRes.ok) throw new Error(pData?.error?.message ?? "Proposals fetch failed");
      setKpis(kData.kpis ?? null);
      setRuns(kData.runs ?? []);
      setProposals(pData.proposals ?? []);
      if (cRes.ok && cData.success) {
        setTuningConfig({ enabled: cData.enabled, allowAutoApply: cData.allowAutoApply });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [windowSize]);

  async function applyProposal(proposalId: string) {
    setApplying(proposalId);
    setError(null);
    try {
      const res = await fetch("/api/observability/tuning/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Apply failed");
      if (data.applied) await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(null);
    }
  }

  async function updateTuningConfig(updates: Partial<TuningConfig>) {
    setConfigSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/observability/tuning/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Update failed");
      if (data.success) {
        setTuningConfig({ enabled: data.enabled, allowAutoApply: data.allowAutoApply });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setConfigSaving(false);
    }
  }

  const topRuns = runs.slice(0, 20);

  const withDetPass = runs.filter((r) => r.quality?.deterministicPassRate != null);
  const detPassRate = withDetPass.length > 0
    ? withDetPass.reduce((s, r) => s + (r.quality!.deterministicPassRate ?? 0), 0) / withDetPass.length
    : null;

  const withQaScore = runs.filter((r) => r.quality?.avgQaQualityScore != null);
  const avgQaScore = withQaScore.length > 0
    ? withQaScore.reduce((s, r) => s + (r.quality!.avgQaQualityScore ?? 0), 0) / withQaScore.length
    : null;

  const withPortfolio = runs.filter((r) => r.routing?.portfolioMode && r.routing.portfolioMode !== "off");
  const budgetBypassRuns = withPortfolio.filter((r) => {
    const top = r.routing?.topBypassReasons?.[0];
    return top && top[0] === "allowed_models_over_budget";
  });
  const budgetBypassRate = withPortfolio.length > 0
    ? (budgetBypassRuns.length / withPortfolio.length) * 100
    : null;

  function applyJsonTest() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const v = result.value as Record<string, unknown>;
    if (typeof v.window === "number" && v.window >= 1) {
      setWindowSize(Math.min(200, Math.max(1, v.window)));
    }
  }

  async function fetchWithJsonTest() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const v = result.value as Record<string, unknown>;
    const w = typeof v.window === "number" && v.window >= 1 ? Math.min(200, Math.max(1, v.window)) : windowSize;
    setWindowSize(w);
    setLoading(true);
    setError(null);
    try {
      const [kRes, pRes, cRes] = await Promise.all([
        fetch(`/api/observability/kpis?window=${w}`),
        fetch(`/api/observability/tuning/proposals?window=${w}`),
        fetch("/api/observability/tuning/config"),
      ]);
      const kData = await kRes.json();
      const pData = await pRes.json();
      const cData = await cRes.json();
      if (!kRes.ok) throw new Error(kData?.error?.message ?? "KPIs fetch failed");
      if (!pRes.ok) throw new Error(pData?.error?.message ?? "Proposals fetch failed");
      setKpis(kData.kpis ?? null);
      setRuns(kData.runs ?? []);
      setProposals(pData.proposals ?? []);
      if (cRes.ok && cData.success) {
        setTuningConfig({ enabled: cData.enabled, allowAutoApply: cData.allowAutoApply });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={opsStyles.spaceY}>
      <div>
        <h1 style={opsStyles.pageTitle}>KPIs</h1>
        <p style={opsStyles.pageSubtitle}>Aggregated metrics and tuning proposals</p>
      </div>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Query</div>
        <div style={{ padding: 24, display: "flex", alignItems: "center", gap: 16 }}>
          <label style={opsStyles.label}>Window</label>
          <input
            type="number"
            value={windowSize}
            onChange={(e) => setWindowSize(Math.max(1, Number(e.target.value) || 50))}
            style={{ ...opsStyles.input, width: 80 }}
          />
          <button onClick={fetchData} disabled={loading} style={{ ...opsStyles.btnSecondary, opacity: loading ? 0.5 : 1 }}>
            Refresh
          </button>
        </div>
      </section>

      {error && <div style={opsStyles.error}>{error}</div>}

      {loading ? (
        <div style={{ ...opsStyles.section, padding: 48, textAlign: "center" }}>
          <p style={opsStyles.muted}>Loading...</p>
        </div>
      ) : kpis ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
            <Card title="Total USD" value={`$${kpis.totals.totalUSD.toFixed(2)}`} sub={`${kpis.window} runs`} />
            <Card title="Avg $/Run" value={`$${kpis.averages.totalUSDPerRun.toFixed(2)}`} />
            <Card title="Packages" value={kpis.totals.packagesTotal} />
            <Card title="Escalations" value={kpis.totals.escalations} />
            <Card title="Bypass Rate" value={`${(kpis.averages.bypassRate * 100).toFixed(1)}%`} />
            <Card title="Council Skipped Rate" value={`${(kpis.averages.councilPlanningSkippedRate * 100).toFixed(1)}%`} />
            <Card title="Variance Recorded" value={kpis.totals.varianceRecorded} />
            <Card title="Variance Skipped" value={kpis.totals.varianceSkipped} />
            {detPassRate != null && (
              <Card title="Deterministic Pass Rate" value={`${(detPassRate * 100).toFixed(1)}%`} sub={`${withDetPass.length} runs`} />
            )}
            {avgQaScore != null && (
              <Card title="Avg QA Score" value={avgQaScore.toFixed(2)} sub={`${withQaScore.length} runs`} />
            )}
            {budgetBypassRate != null && (
              <Card title="Budget Bypass Rate (Lock Mode)" value={`${budgetBypassRate.toFixed(1)}%`} sub={`${budgetBypassRuns.length}/${withPortfolio.length} portfolio runs`} />
            )}
          </div>

          {tuningConfig != null && (
            <section style={opsStyles.section}>
              <div style={opsStyles.sectionHeader}>Tuning Config</div>
              <div style={{ padding: 24, display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={tuningConfig.enabled}
                    onChange={(e) => updateTuningConfig({ enabled: e.target.checked })}
                    disabled={configSaving}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Enabled</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={tuningConfig.allowAutoApply}
                    onChange={(e) => updateTuningConfig({ allowAutoApply: e.target.checked })}
                    disabled={configSaving}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Allow Auto-Apply</span>
                </label>
                {configSaving && <span style={opsStyles.muted}>Saving...</span>}
              </div>
            </section>
          )}

          {kpis.recommendations.length > 0 && (
            <section style={opsStyles.section}>
              <div style={opsStyles.sectionHeader}>Recommendations</div>
              <div style={{ padding: 24 }}>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, color: "#334155" }}>
                  {kpis.recommendations.map((r, i) => (
                    <li key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <span style={{ color: "#94a3b8" }}>•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section style={opsStyles.section}>
            <div style={opsStyles.sectionHeader}>Runs (top 20)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={opsStyles.table}>
                <thead>
                  <tr>
                    <th style={opsStyles.th}>Started</th>
                    <th style={{ ...opsStyles.th, textAlign: "right" }}>Total $</th>
                    <th style={opsStyles.th}>Portfolio</th>
                    <th style={{ ...opsStyles.th, textAlign: "right" }}>Bypass %</th>
                    <th style={{ ...opsStyles.th, textAlign: "right" }}>Escalations</th>
                    <th style={opsStyles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {topRuns.map((r) => (
                    <tr key={r.runSessionId}>
                      <td style={opsStyles.td}>{new Date(r.startedAtISO).toLocaleString()}</td>
                      <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>${(r.costs?.totalUSD ?? 0).toFixed(4)}</td>
                      <td style={opsStyles.td}>{r.routing?.portfolioMode ?? "—"}</td>
                      <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                        {r.routing?.bypassRate != null ? (r.routing.bypassRate * 100).toFixed(1) + "%" : "—"}
                      </td>
                      <td style={{ ...opsStyles.td, textAlign: "right" }}>{r.governance?.escalations ?? 0}</td>
                      <td style={opsStyles.td}>
                        <Link href={`/ops/runs/${r.runSessionId}`} style={opsStyles.link}>View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={opsStyles.section}>
            <div style={opsStyles.sectionHeader}>Tuning Proposals</div>
            <div style={{ padding: 24 }}>
              {proposals.length === 0 ? (
                <p style={opsStyles.muted}>No proposals.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {proposals.map((p) => (
                    <div key={p.id} style={{ borderRadius: 6, border: "1px solid #e2e8f0", padding: 16 }}>
                      <div style={{ fontWeight: 500, color: "#1e293b" }}>{p.action}</div>
                      <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>{p.rationale}</div>
                      <div style={{ marginTop: 12 }}>
                        <button
                          onClick={() => applyProposal(p.id)}
                          disabled={applying != null || !p.safeToAutoApply}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 500,
                            borderRadius: 6,
                            border: "none",
                            cursor: p.safeToAutoApply && !applying ? "pointer" : "not-allowed",
                            background: p.safeToAutoApply && !applying ? "#2e7d32" : "#94a3b8",
                            color: "#fff",
                            opacity: applying ? 0.5 : 1,
                          }}
                        >
                          {applying === p.id ? "Applying..." : p.safeToAutoApply ? "Apply" : "Not safe"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <div style={{ ...opsStyles.section, padding: 48, textAlign: "center" }}>
          <p style={opsStyles.muted}>No KPIs data.</p>
        </div>
      )}

      <details style={opsStyles.section}>
        <summary style={opsStyles.detailsSummary}>
          <span>▶</span>
          Test JSON
        </summary>
        <div style={opsStyles.detailsContent}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Mode</label>
            <select
              value={jsonTestMode}
              onChange={(e) => setJsonTestMode(e.target.value as typeof jsonTestMode)}
              style={opsStyles.select}
            >
              <option value="KpisQuery">KpisQuery</option>
              <option value="TuningProposalsQuery">TuningProposalsQuery</option>
            </select>
          </div>
          <textarea
            value={jsonTestInput}
            onChange={(e) => { setJsonTestInput(e.target.value); setJsonParseError(null); }}
            placeholder='{"window":50}'
            style={opsStyles.textarea}
            rows={3}
          />
          {jsonParseError && <div style={{ fontSize: 13, color: "#c62828", marginTop: 8 }}>{jsonParseError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={applyJsonTest} style={opsStyles.btnSecondary}>
              Apply JSON
            </button>
            <button onClick={fetchWithJsonTest} disabled={loading} style={{ ...opsStyles.btnViolet, opacity: loading ? 0.5 : 1 }}>
              Fetch with JSON
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
