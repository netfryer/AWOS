// ─── app/ops/runs/[id]/page.tsx ──────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { opsStyles } from "../../styles";

interface Ledger {
  runSessionId: string;
  startedAtISO: string;
  finishedAtISO?: string;
  costs: {
    councilUSD: number;
    workerUSD: number;
    qaUSD: number;
    deterministicQaUSD: number;
  };
  variance: {
    recorded: number;
    skipped: number;
    skipReasons: Record<string, number>;
  };
  decisions: Array<{
    tsISO: string;
    type: string;
    packageId?: string;
    details: Record<string, unknown>;
  }>;
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

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre style={opsStyles.jsonBlock}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/** Migration shim: normalize older ledger fields for display (cheapestViableRequested -> enforceCheapestViable, etc.) */
function normalizeDecisionDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object") return details;
  const out = { ...details };
  if (out.enforceCheapestViable == null && out.cheapestViableRequested != null) {
    out.enforceCheapestViable = out.cheapestViableRequested;
  }
  if (out.chosenIsCheapestViable == null && out.cheapestViableSelected != null) {
    out.chosenIsCheapestViable = out.cheapestViableSelected;
  }
  return out;
}

function CollapsibleJson({ title, data }: { title: string; data: unknown }) {
  return (
    <details style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
      <summary style={{ ...opsStyles.detailsSummary, padding: "12px 16px" }}>
        <span>▶</span>
        {title}
      </summary>
      <div style={{ padding: 16, borderTop: "1px solid #e2e8f0" }}>
        <JsonBlock data={data} />
      </div>
    </details>
  );
}

interface ScoreBreakdown {
  baseReliability: number;
  expertiseComponent: number;
  priorQualityComponent: number;
  statusPenalty: number;
  costPenalty: number;
  adjustedCostUSD: number;
  finalScore: number;
}

interface CompBreakdown {
  predictedCostUSD: number;
  expectedCostUSD: number;
  costMultiplierUsed: number;
  inputsBreakdown: {
    inPer1k: number;
    outPer1k: number;
    inputTokens: number;
    outputTokens: number;
    rawCostUSD: number;
    costMultiplierUsed: number;
  };
}

interface RoutingCandidate {
  modelId: string;
  predictedCostUSD?: number;
  passed?: boolean;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  compBreakdown?: CompBreakdown;
}

function ScoreBreakdownTable({ b }: { b: ScoreBreakdown }) {
  const rows: [string, string][] = [
    ["baseReliability", b.baseReliability.toFixed(3)],
    ["expertiseComponent", b.expertiseComponent.toFixed(3)],
    ["priorQualityComponent", b.priorQualityComponent.toFixed(3)],
    ["statusPenalty", b.statusPenalty.toFixed(3)],
    ["costPenalty", b.costPenalty.toFixed(3)],
    ["adjustedCostUSD", `$${b.adjustedCostUSD.toFixed(6)}`],
    ["finalScore", b.finalScore.toFixed(3)],
  ];
  return (
    <table style={{ ...opsStyles.table, fontSize: 12, marginTop: 4 }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ ...opsStyles.td, padding: "4px 8px", color: "#64748b" }}>{k}</td>
            <td style={{ ...opsStyles.td, padding: "4px 8px", fontFamily: "monospace" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompBreakdownTable({ b }: { b: CompBreakdown }) {
  const { inputsBreakdown } = b;
  const rows: [string, string][] = [
    ["predictedCostUSD", `$${b.predictedCostUSD.toFixed(6)}`],
    ["expectedCostUSD", `$${b.expectedCostUSD.toFixed(6)}`],
    ["costMultiplierUsed", String(b.costMultiplierUsed)],
    ["inPer1k", String(inputsBreakdown.inPer1k)],
    ["outPer1k", String(inputsBreakdown.outPer1k)],
    ["inputTokens", String(inputsBreakdown.inputTokens)],
    ["outputTokens", String(inputsBreakdown.outputTokens)],
    ["rawCostUSD", `$${inputsBreakdown.rawCostUSD.toFixed(6)}`],
  ];
  return (
    <table style={{ ...opsStyles.table, fontSize: 12, marginTop: 4 }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ ...opsStyles.td, padding: "4px 8px", color: "#64748b" }}>{k}</td>
            <td style={{ ...opsStyles.td, padding: "4px 8px", fontFamily: "monospace" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RouteCandidatesWithScoreDetails({ candidates }: { candidates: RoutingCandidate[] }) {
  const withScoreBreakdown = candidates.filter((c) => c.scoreBreakdown);
  const withCompBreakdown = candidates.filter((c) => c.compBreakdown);
  if (withScoreBreakdown.length === 0 && withCompBreakdown.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      {withScoreBreakdown.map((c) => (
        <details key={`score-${c.modelId}`} style={{ marginBottom: 8, borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <summary style={{ ...opsStyles.detailsSummary, padding: "8px 12px", fontSize: 12 }}>
            <span>▶</span>
            Score details: {c.modelId}
            {c.score != null && <span style={{ marginLeft: 8, color: "#64748b" }}>(score: {c.score.toFixed(3)})</span>}
          </summary>
          <div style={{ padding: 12, borderTop: "1px solid #e2e8f0", background: "#fafafa" }}>
            {c.scoreBreakdown && <ScoreBreakdownTable b={c.scoreBreakdown} />}
          </div>
        </details>
      ))}
      {withCompBreakdown.map((c) => (
        <details key={`cost-${c.modelId}`} style={{ marginBottom: 8, borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <summary style={{ ...opsStyles.detailsSummary, padding: "8px 12px", fontSize: 12 }}>
            <span>▶</span>
            Cost details: {c.modelId}
            {c.compBreakdown && (
              <span style={{ marginLeft: 8, color: "#64748b" }}>
                (predicted: ${c.compBreakdown.predictedCostUSD.toFixed(6)})
              </span>
            )}
          </summary>
          <div style={{ padding: 12, borderTop: "1px solid #e2e8f0", background: "#fafafa" }}>
            {c.compBreakdown && <CompBreakdownTable b={c.compBreakdown} />}
          </div>
        </details>
      ))}
    </div>
  );
}

export default function OpsRunDetailPage() {
  const params = useParams();
  const routeId = params?.id as string;
  const [queryId, setQueryId] = useState(routeId);
  const [bundleTrust, setBundleTrust] = useState(true);
  const [bundleVariance, setBundleVariance] = useState(true);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [jsonTestInput, setJsonTestInput] = useState("");
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);

  useEffect(() => {
    if (routeId) setQueryId(routeId);
  }, [routeId]);

  useEffect(() => {
    if (!queryId) return;
    setLedger(null);
    setLoading(true);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/ledger?id=${queryId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
        if (!cancelled) setLedger(data.ledger);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [queryId]);

  function applyJsonTest() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const v = result.value as Record<string, unknown>;
    if (typeof v.id === "string") setQueryId(v.id);
    if (typeof v.trust === "boolean") setBundleTrust(v.trust);
    if (typeof v.variance === "boolean") setBundleVariance(v.variance);
  }

  async function fetchLedgerClick() {
    if (!queryId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/ledger?id=${queryId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setLedger(data.ledger);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  async function downloadBundle() {
    if (!queryId) return;
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      params.set("id", queryId);
      if (!bundleTrust) params.set("trust", "false");
      if (!bundleVariance) params.set("variance", "false");
      const res = await fetch(`/api/projects/run-bundle?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Download failed");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `run-bundle-${queryId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const id = queryId;

  if (loading && !ledger) {
    return (
      <div style={opsStyles.spaceY}>
        <div style={{ padding: 48, textAlign: "center" }}><p style={opsStyles.muted}>Loading...</p></div>
      </div>
    );
  }
  if (error && !ledger) {
    return (
      <div style={opsStyles.spaceY}>
        <div style={opsStyles.error}>{error}</div>
      </div>
    );
  }
  if (!ledger) {
    return (
      <div style={opsStyles.spaceY}>
        <div style={{ padding: 48, textAlign: "center" }}><p style={opsStyles.muted}>Not found.</p></div>
      </div>
    );
  }

  const totalUSD =
    ledger.costs.councilUSD +
    ledger.costs.workerUSD +
    ledger.costs.qaUSD +
    ledger.costs.deterministicQaUSD;

  const routeDecisions = ledger.decisions.filter((d) => d.type === "ROUTE");
  const bypassed = routeDecisions.filter((d) => d.details?.portfolioBypassed === true);
  const bypassReasons: Record<string, number> = {};
  for (const d of bypassed) {
    const r = String(d.details?.bypassReason ?? "unknown");
    bypassReasons[r] = (bypassReasons[r] ?? 0) + 1;
  }
  const topBypassReasons = Object.entries(bypassReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topSkipReasons = Object.entries(ledger.variance.skipReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const pricingMismatchTotal = ledger.decisions.reduce(
    (acc, d) => acc + (d.type === "ROUTE" ? (d.details?.pricingMismatchCount as number ?? 0) : 0),
    0
  );

  return (
    <div style={opsStyles.spaceY}>
      {pricingMismatchTotal > 0 && (
        <div style={{ padding: 16, background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, color: "#92400e" }}>
          <strong>Pricing mismatch warning:</strong> {pricingMismatchTotal} routing candidate(s) have predictedCostUSD diverging from registry pricing by more than 2×. Check ROUTE decision details for pricingMismatches.
        </div>
      )}
      <div>
        <Link href="/ops/runs" style={opsStyles.link}>← Back to Runs</Link>
        <h1 style={{ ...opsStyles.pageTitle, marginTop: 8 }}>Run {id.slice(0, 8)}...</h1>
        <p style={opsStyles.pageSubtitle}>Ledger and cost breakdown</p>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={fetchLedgerClick} disabled={loading} style={opsStyles.btnSecondary}>
          Fetch Ledger
        </button>
        <button onClick={downloadBundle} disabled={downloading} style={opsStyles.btnSecondary}>
          {downloading ? "Downloading..." : "Download Bundle"}
        </button>
      </div>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Costs</div>
        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 13 }}>
          <div>
            <div style={opsStyles.label}>Council</div>
            <div style={{ fontFamily: "monospace", color: "#1e293b" }}>${ledger.costs.councilUSD.toFixed(4)}</div>
          </div>
          <div>
            <div style={opsStyles.label}>Worker</div>
            <div style={{ fontFamily: "monospace", color: "#1e293b" }}>${ledger.costs.workerUSD.toFixed(4)}</div>
          </div>
          <div>
            <div style={opsStyles.label}>QA</div>
            <div style={{ fontFamily: "monospace", color: "#1e293b" }}>${ledger.costs.qaUSD.toFixed(4)}</div>
          </div>
          <div>
            <div style={opsStyles.label}>Deterministic QA</div>
            <div style={{ fontFamily: "monospace", color: "#1e293b" }}>${ledger.costs.deterministicQaUSD.toFixed(4)}</div>
          </div>
          <div style={{ gridColumn: "1 / -1", paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
            <div style={opsStyles.label}>Total</div>
            <div style={{ fontFamily: "monospace", fontWeight: 600, color: "#1e293b" }}>${totalUSD.toFixed(4)}</div>
          </div>
        </div>
      </section>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Variance</div>
        <div style={{ padding: 24, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
            <div>
              <div style={opsStyles.label}>Recorded</div>
              <div style={{ fontFamily: "monospace", color: "#1e293b" }}>{ledger.variance.recorded}</div>
            </div>
            <div>
              <div style={opsStyles.label}>Skipped</div>
              <div style={{ fontFamily: "monospace", color: "#1e293b" }}>{ledger.variance.skipped}</div>
            </div>
          </div>
          {topSkipReasons.length > 0 && (
            <div>
              <div style={{ fontWeight: 500, color: "#475569", marginBottom: 8 }}>Top skip reasons</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {topSkipReasons.map(([reason, count]) => (
                  <li key={reason} style={{ color: "#334155", display: "flex", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", color: "#64748b" }}>{reason}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {topBypassReasons.length > 0 && (
        <section style={opsStyles.section}>
          <div style={opsStyles.sectionHeader}>Routing Bypass Reasons</div>
          <div style={{ padding: 24 }}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {topBypassReasons.map(([reason, count]) => (
                <li key={reason} style={{ color: "#334155", display: "flex", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: "monospace", color: "#64748b" }}>{reason}</span>
                  <span>{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Decisions</div>
        <div style={{ maxHeight: 384, overflow: "auto" }}>
          {ledger.decisions.map((d, i) => (
            <div key={i} style={{ padding: 16, borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13, color: "#475569", marginBottom: 8 }}>
                <span>{new Date(d.tsISO).toLocaleString()}</span>
                <span style={{ fontWeight: 500, color: "#334155" }}>{d.type}</span>
                {d.packageId && <span style={{ fontFamily: "monospace", color: "#64748b" }}>{d.packageId}</span>}
              </div>
              {d.type === "ROUTE" && Array.isArray(d.details?.routingCandidates) && (
                <RouteCandidatesWithScoreDetails candidates={d.details.routingCandidates as RoutingCandidate[]} />
              )}
              <CollapsibleJson title="Details" data={normalizeDecisionDetails(d.details as Record<string, unknown>)} />
            </div>
          ))}
          {ledger.decisions.length === 0 && (
            <div style={{ padding: 32, textAlign: "center" }}><p style={opsStyles.muted}>No decisions.</p></div>
          )}
        </div>
      </section>

      <details style={opsStyles.section}>
        <summary style={opsStyles.detailsSummary}>
          <span>▶</span>
          Test JSON
        </summary>
        <div style={opsStyles.detailsContent}>
          <textarea
            value={jsonTestInput}
            onChange={(e) => { setJsonTestInput(e.target.value); setJsonParseError(null); }}
            placeholder='{"id":"run-session-id","trust":true,"variance":true}'
            style={opsStyles.textarea}
            rows={3}
          />
          {jsonParseError && <div style={{ fontSize: 13, color: "#c62828", marginTop: 8 }}>{jsonParseError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={applyJsonTest} style={opsStyles.btnSecondary}>Apply JSON</button>
            <button onClick={fetchLedgerClick} disabled={loading} style={{ ...opsStyles.btnViolet, opacity: loading ? 0.5 : 1 }}>Fetch Ledger</button>
            <button onClick={downloadBundle} disabled={downloading} style={{ ...opsStyles.btnViolet, opacity: downloading ? 0.5 : 1 }}>Download Bundle</button>
          </div>
        </div>
      </details>
    </div>
  );
}
