// ─── app/ops/runs/page.tsx ──────────────────────────────────────────────────

"use client";

import { useState, useEffect, useMemo, Fragment } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";

interface RunSummary {
  runSessionId: string;
  startedAtISO: string;
  costs: { totalUSD: number; qaUSD?: number };
  variance?: { recorded: number; skipped: number };
  routing?: {
    portfolioMode?: string;
    bypassRate?: number;
    topBypassReasons?: [string, number][];
  };
  governance?: { escalations?: number; councilPlanningSkipped?: boolean };
  quality?: { avgQaQualityScore?: number };
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

const TIME_RANGE_MAP: Record<string, number> = { all: 0, "1h": 1, "6h": 6, "24h": 24, "72h": 72 };

const PORTFOLIO_OPTIONS = ["all", "off", "prefer", "lock"] as const;
const HOURS_OPTIONS = [
  { value: 0, label: "All" },
  { value: 1, label: "Last 1h" },
  { value: 6, label: "Last 6h" },
  { value: 24, label: "Last 24h" },
  { value: 72, label: "Last 72h" },
];

export default function OpsRunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [portfolioFilter, setPortfolioFilter] = useState<string>("all");
  const [hoursFilter, setHoursFilter] = useState<number>(0);
  const [minBypassPct, setMinBypassPct] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [jsonTestInput, setJsonTestInput] = useState("");
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRuns() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/observability/runs?limit=${limit}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
        setRuns(data.runs ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        setLoading(false);
      }
    }
    fetchRuns();
  }, [limit]);

  async function applyJsonTestAndRefresh() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const v = result.value as Record<string, unknown>;
    const newLimit = typeof v.limit === "number" && v.limit >= 1 ? Math.min(200, v.limit) : limit;
    if (newLimit !== limit) setLimit(newLimit);
    if (["all", "off", "prefer", "lock"].includes(String(v.portfolioMode))) setPortfolioFilter(String(v.portfolioMode));
    const tr = String(v.timeRange ?? "");
    if (tr in TIME_RANGE_MAP) setHoursFilter(TIME_RANGE_MAP[tr]);
    if (typeof v.minBypassPct === "number" && v.minBypassPct >= 0 && v.minBypassPct <= 100) setMinBypassPct(v.minBypassPct);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/observability/runs?limit=${newLimit}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setRuns(data.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  const filteredRuns = useMemo(() => {
    let out = runs;
    if (portfolioFilter !== "all") {
      out = out.filter((r) => (r.routing?.portfolioMode ?? "off") === portfolioFilter);
    }
    if (hoursFilter > 0) {
      const cutoff = new Date(Date.now() - hoursFilter * 60 * 60 * 1000);
      out = out.filter((r) => new Date(r.startedAtISO) >= cutoff);
    }
    if (minBypassPct > 0) {
      const threshold = minBypassPct / 100;
      out = out.filter((r) => (r.routing?.bypassRate ?? 0) >= threshold);
    }
    return out;
  }, [runs, portfolioFilter, hoursFilter, minBypassPct]);

  const thRight = { ...opsStyles.th, textAlign: "right" as const };
  return (
    <div style={opsStyles.spaceY}>
      <div>
        <h1 style={opsStyles.pageTitle}>Runs</h1>
        <p style={opsStyles.pageSubtitle}>View and filter run history</p>
      </div>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Filters</div>
        <div style={{ padding: 24, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={opsStyles.label}>Limit</label>
            <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 50)} style={{ ...opsStyles.input, width: 80 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={opsStyles.label}>Portfolio</label>
            <select value={portfolioFilter} onChange={(e) => setPortfolioFilter(e.target.value)} style={opsStyles.select}>
              {PORTFOLIO_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={opsStyles.label}>Time</label>
            <select value={hoursFilter} onChange={(e) => setHoursFilter(Number(e.target.value))} style={opsStyles.select}>
              {HOURS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={opsStyles.label}>Bypass ≥</label>
            <input type="range" min={0} max={100} value={minBypassPct} onChange={(e) => setMinBypassPct(Number(e.target.value))} style={{ width: 112, height: 8 }} />
            <span style={{ fontSize: 13, fontFamily: "monospace", color: "#475569", width: 40 }}>{minBypassPct}%</span>
          </div>
        </div>
      </section>

      {error && <div style={opsStyles.error}>{error}</div>}

      {loading ? (
        <div style={{ ...opsStyles.section, padding: 48, textAlign: "center" }}>
          <p style={opsStyles.muted}>Loading...</p>
        </div>
      ) : (
        <section style={opsStyles.section}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...opsStyles.table, minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={opsStyles.th}>Started</th>
                  <th style={thRight}>Total $</th>
                  <th style={opsStyles.th}>Portfolio</th>
                  <th style={thRight}>Bypass %</th>
                  <th style={thRight}>Escalations</th>
                  <th style={opsStyles.th}>Council Skipped</th>
                  <th style={thRight}>Avg QA Score</th>
                  <th style={thRight}>QA $ Share</th>
                  <th style={thRight}>Var Skipped %</th>
                  <th style={opsStyles.th}></th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((r) => {
                  const totalUSD = r.costs?.totalUSD ?? 0;
                  const qaUSD = r.costs?.qaUSD ?? 0;
                  const qaUSDShare = totalUSD > 0 ? qaUSD / totalUSD : null;
                  const rec = r.variance?.recorded ?? 0;
                  const sk = r.variance?.skipped ?? 0;
                  const varianceSkippedPct = rec + sk > 0 ? (sk / (rec + sk)) * 100 : null;
                  const topReasons = r.routing?.topBypassReasons ?? [];
                  const hasReasons = topReasons.length > 0;
                  const isExpanded = expandedId === r.runSessionId;
                  return (
                    <Fragment key={r.runSessionId}>
                      <tr>
                        <td style={opsStyles.td}>
                          {hasReasons ? (
                            <button
                              type="button"
                              onClick={() => setExpandedId(isExpanded ? null : r.runSessionId)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", color: "#1976d2", display: "flex", alignItems: "center", gap: 4 }}
                              aria-expanded={isExpanded}
                            >
                              {new Date(r.startedAtISO).toLocaleString()}
                              <span style={{ color: "#94a3b8", fontSize: 11 }}>{isExpanded ? "▼" : "▶"}</span>
                            </button>
                          ) : (
                            <span style={{ color: "#334155" }}>{new Date(r.startedAtISO).toLocaleString()}</span>
                          )}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>${totalUSD.toFixed(4)}</td>
                        <td style={opsStyles.td}>{r.routing?.portfolioMode ?? "—"}</td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {r.routing?.bypassRate != null ? (r.routing.bypassRate * 100).toFixed(1) + "%" : "—"}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right" }}>{r.governance?.escalations ?? 0}</td>
                        <td style={opsStyles.td}>{r.governance?.councilPlanningSkipped ? "Yes" : "—"}</td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {r.quality?.avgQaQualityScore != null ? r.quality.avgQaQualityScore.toFixed(2) : "—"}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {qaUSDShare != null ? (qaUSDShare * 100).toFixed(1) + "%" : "—"}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>
                          {varianceSkippedPct != null ? varianceSkippedPct.toFixed(1) + "%" : "—"}
                        </td>
                        <td style={opsStyles.td}>
                          <Link href={`/ops/runs/${r.runSessionId}`} style={opsStyles.link}>View</Link>
                        </td>
                      </tr>
                      {isExpanded && hasReasons && (
                        <tr key={`${r.runSessionId}-detail`}>
                          <td colSpan={10} style={{ padding: 16, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                            <div style={{ fontSize: 13 }}>
                              <div style={{ fontWeight: 500, color: "#475569", marginBottom: 8 }}>Top bypass reasons</div>
                              <ul style={{ display: "flex", flexWrap: "wrap", gap: "4px 24px", margin: 0, padding: 0, listStyle: "none" }}>
                                {topReasons.map(([reason, count]) => (
                                  <li key={reason} style={{ color: "#334155" }}>
                                    <span style={{ fontFamily: "monospace" }}>{reason}</span>: {count}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredRuns.length === 0 && (
            <div style={{ padding: 48, textAlign: "center" }}>
              <p style={opsStyles.muted}>No runs found.</p>
            </div>
          )}
        </section>
      )}

      <details style={opsStyles.section}>
        <summary style={opsStyles.detailsSummary}>
          <span>▶</span>
          Test JSON
        </summary>
        <div style={opsStyles.detailsContent}>
          <textarea
            value={jsonTestInput}
            onChange={(e) => { setJsonTestInput(e.target.value); setJsonParseError(null); }}
            placeholder='{"limit":50,"portfolioMode":"all","timeRange":"all|1h|6h|24h|72h","minBypassPct":0}'
            style={opsStyles.textarea}
            rows={3}
          />
          {jsonParseError && <div style={{ fontSize: 13, color: "#c62828", marginTop: 8 }}>{jsonParseError}</div>}
          <button onClick={applyJsonTestAndRefresh} disabled={loading} style={{ ...opsStyles.btnViolet, opacity: loading ? 0.5 : 1, marginTop: 16 }}>
            Apply JSON
          </button>
        </div>
      </details>
    </div>
  );
}
