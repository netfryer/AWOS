// ─── app/ops/runs/[id]/page.tsx ──────────────────────────────────────────────
// Run detail page: summary cards, route decisions table, side panel,
// QA results, escalations, Copy summary, raw JSON collapsed.

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { opsStyles } from "../../styles";
import { DeliveryPreview } from "../../demo/DeliveryPreview";

interface RoutingCandidate {
  modelId: string;
  predictedCostUSD: number;
  predictedQuality?: number;
  passed: boolean;
  disqualifiedReason?: string;
  score?: number;
  scoreBreakdown?: Record<string, number>;
}

interface RouteDecision {
  type: string;
  packageId?: string;
  details?: {
    tierProfile?: string;
    chosenModelId?: string;
    chosenPredictedCostUSD?: number;
    rankedBy?: string;
    enforceCheapestViable?: boolean;
    routingCandidates?: RoutingCandidate[];
    pricingMismatchCount?: number;
    pricingMismatches?: unknown[];
  };
}

interface Ledger {
  runSessionId: string;
  costs?: { councilUSD?: number; workerUSD?: number; qaUSD?: number; deterministicQaUSD?: number };
  decisions?: RouteDecision[];
}

interface RunResult {
  runs?: Array<{ packageId: string; modelId: string; actualCostUSD: number; output?: string }>;
  qaResults?: Array<{ packageId: string; workerPackageId: string; pass: boolean; qualityScore: number }>;
  escalations?: unknown[];
  budget?: { startingUSD: number; remainingUSD: number };
}

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = (_k: string, v: unknown): unknown => {
    if (v != null && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  };
  try {
    return JSON.stringify(obj, replacer, 2);
  } catch {
    return String(obj ?? "");
  }
}

function buildSummaryMarkdown(
  id: string,
  totalCost: number | undefined,
  runCount: number,
  qaPass: boolean | null,
  qaScore: string | null,
  escalations: number,
  modelsUsed: number
): string {
  const lines: string[] = [
    `# Run Summary`,
    ``,
    `**Session:** \`${id}\``,
    ``,
    `## Outcomes`,
    `- **Total cost:** $${totalCost?.toFixed(4) ?? "—"}`,
    `- **Packages run:** ${runCount}`,
    `- **QA:** ${qaPass === null ? "—" : qaPass ? `Pass (${qaScore})` : `Fail (${qaScore})`}`,
    `- **Escalations:** ${escalations} ${escalations === 0 ? "✓" : ""}`,
    `- **Models used:** ${modelsUsed}`,
  ];
  return lines.join("\n");
}

export default function RunDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [bundle, setBundle] = useState<{ ledger?: Ledger } | null>(null);
  const [session, setSession] = useState<{ progress?: { partialResult?: RunResult } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<RouteDecision | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [bundleRes, sessionRes] = await Promise.all([
        fetch(`/api/projects/run-bundle?id=${encodeURIComponent(id)}`),
        fetch(`/api/projects/run-session?id=${encodeURIComponent(id)}`),
      ]);
      const bundleData = await bundleRes.json();
      const sessionData = await sessionRes.json();
      if (bundleRes.ok) {
        setBundle(bundleData.bundle ? { ledger: bundleData.bundle.ledger } : null);
      }
      if (sessionRes.ok) {
        setSession(sessionData.session ? { progress: sessionData.session.progress } : null);
      }
      if (!bundleRes.ok) {
        const demoRes = await fetch(`/api/ops/demo/runs/${encodeURIComponent(id)}`);
        if (demoRes.ok) {
          const demoData = await demoRes.json();
          setBundle(demoData.run?.bundle ? { ledger: demoData.run.bundle.ledger } : null);
          if (!sessionRes.ok && demoData.run?.result) {
            setSession({ progress: { partialResult: demoData.run.result } });
          }
        } else if (!sessionRes.ok) {
          throw new Error("Run not found");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopySummary = useCallback(() => {
    const ledger = bundle?.ledger;
    const result = session?.progress?.partialResult;
    const totalCost = result?.budget
      ? result.budget.startingUSD - (result.budget.remainingUSD ?? 0)
      : ledger?.costs
        ? (ledger.costs.councilUSD ?? 0) + (ledger.costs.workerUSD ?? 0) + (ledger.costs.qaUSD ?? 0) + (ledger.costs.deterministicQaUSD ?? 0)
        : undefined;
    const qaResults = result?.qaResults ?? [];
    const qaPass = qaResults.length > 0 ? qaResults.every((q) => q.pass) : null;
    const qaScore =
      qaResults.length > 0 ? (qaResults.reduce((a, q) => a + q.qualityScore, 0) / qaResults.length).toFixed(2) : null;
    const escalations = result?.escalations?.length ?? 0;
    const modelsUsed = new Set(result?.runs?.map((r) => r.modelId) ?? []).size;
    const md = buildSummaryMarkdown(id, totalCost, result?.runs?.length ?? 0, qaPass, qaScore, escalations, modelsUsed);
    navigator.clipboard.writeText(md);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  }, [id, bundle, session]);

  if (loading) {
    return (
      <div style={{ padding: 48 }}>
        <p style={{ fontSize: 15, color: "#64748b" }}>Loading run…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 48 }}>
        <Link href="/ops/runs" style={{ ...opsStyles.link, marginBottom: 16, display: "inline-block" }}>
          ← Back to Runs
        </Link>
        <div style={opsStyles.error}>{error}</div>
      </div>
    );
  }

  const ledger = bundle?.ledger;
  const result = session?.progress?.partialResult;
  const decisions = ledger?.decisions ?? [];
  const routeDecisions = decisions.filter((d) => d.type === "ROUTE");
  const runByPkg = new Map(result?.runs?.map((r) => [r.packageId, r]) ?? []);

  const totalCost =
    result?.budget != null
      ? result.budget.startingUSD - (result.budget.remainingUSD ?? 0)
      : ledger?.costs
        ? (ledger.costs.councilUSD ?? 0) + (ledger.costs.workerUSD ?? 0) + (ledger.costs.qaUSD ?? 0) + (ledger.costs.deterministicQaUSD ?? 0)
        : undefined;
  const qaResults = result?.qaResults ?? [];
  const qaPass = qaResults.length > 0 ? qaResults.every((q) => q.pass) : null;
  const qaScore =
    qaResults.length > 0 ? (qaResults.reduce((a, q) => a + q.qualityScore, 0) / qaResults.length).toFixed(2) : null;
  const escalations = result?.escalations?.length ?? 0;
  const modelsUsed = new Set(result?.runs?.map((r) => r.modelId) ?? []).size;

  const fullData = { bundle, session };
  const aggRun = result?.runs?.find((r) => r.packageId === "aggregation-report" || r.packageId?.includes("aggregation"));
  const deliverableOutput = aggRun?.output ?? null;
  const handleExportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [id, bundle, session]);

  return (
    <div style={{ maxWidth: 1024, margin: "0 auto" }}>
      <Link href="/ops/runs" style={{ ...opsStyles.link, fontSize: 14, marginBottom: 20, display: "inline-block" }}>
        ← Back to Runs
      </Link>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={opsStyles.pageTitle}>Run detail</h1>
          <p style={opsStyles.pageSubtitle}>
            <code style={{ fontFamily: "monospace", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
              {id}
            </code>
          </p>
        </div>
        <button onClick={handleCopySummary} style={opsStyles.btnSecondary}>
          {copyFeedback ? "Copied!" : "Copy summary"}
        </button>
      </header>

      {/* 1) Summary cards */}
      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Summary</div>
        <div style={{ ...opsStyles.sectionBody, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 16 }}>
          {totalCost != null && (
            <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Total cost</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>${totalCost.toFixed(4)}</div>
            </div>
          )}
          <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Packages</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>{result?.runs?.length ?? 0}</div>
          </div>
          {qaScore != null && (
            <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>QA</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: qaPass ? "#2e7d32" : "#c62828" }}>
                {qaPass ? "Pass" : "Fail"} ({qaScore})
              </div>
            </div>
          )}
          <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Escalations</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: escalations === 0 ? "#2e7d32" : "#c62828" }}>{escalations}</div>
          </div>
          <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Models</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>{modelsUsed}</div>
          </div>
        </div>
      </section>

      {/* 2) Route decisions table + side panel */}
      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Route decisions</div>
        <div style={opsStyles.sectionBody}>
          {routeDecisions.length > 0 ? (
            <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={opsStyles.table}>
                <thead>
                  <tr>
                    <th style={opsStyles.th}>packageId</th>
                    <th style={opsStyles.th}>tierProfile</th>
                    <th style={opsStyles.th}>chosenModelId</th>
                    <th style={opsStyles.th}>rankedBy</th>
                    <th style={opsStyles.th}>enforceCheapestViable</th>
                    <th style={{ ...opsStyles.th, textAlign: "right" }}>predictedCostUSD</th>
                    <th style={{ ...opsStyles.th, textAlign: "right" }}>actualCostUSD</th>
                  </tr>
                </thead>
                <tbody>
                  {routeDecisions.map((d, i) => {
                    const run = d.packageId ? runByPkg.get(d.packageId) : undefined;
                    return (
                      <tr
                        key={i}
                        onClick={() => setSelectedRoute(d)}
                        style={{ cursor: "pointer", background: selectedRoute === d ? "#e0f2fe" : undefined }}
                      >
                        <td style={opsStyles.td}>{d.packageId ?? "—"}</td>
                        <td style={opsStyles.td}>{d.details?.tierProfile ?? "—"}</td>
                        <td style={opsStyles.td}>{d.details?.chosenModelId ?? "—"}</td>
                        <td style={opsStyles.td}>{d.details?.rankedBy ?? "—"}</td>
                        <td style={opsStyles.td}>{d.details?.enforceCheapestViable ? "Yes" : "—"}</td>
                        <td style={{ ...opsStyles.td, textAlign: "right" }}>
                          {d.details?.chosenPredictedCostUSD != null ? `$${d.details.chosenPredictedCostUSD.toFixed(4)}` : "—"}
                        </td>
                        <td style={{ ...opsStyles.td, textAlign: "right" }}>
                          {run?.actualCostUSD != null ? `$${run.actualCostUSD.toFixed(4)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "#64748b", fontSize: 14 }}>No route decisions.</p>
          )}

          {/* Side panel */}
          {selectedRoute && (
            <div
              style={{
                position: "fixed",
                top: 0,
                right: 0,
                width: 420,
                maxWidth: "100%",
                height: "100%",
                background: "#fff",
                boxShadow: "-4px 0 12px rgba(0,0,0,0.1)",
                zIndex: 100,
                overflow: "auto",
                padding: 24,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Route: {selectedRoute.packageId}</h3>
                <button onClick={() => setSelectedRoute(null)} style={opsStyles.btnSecondary}>
                  Close
                </button>
              </div>
              {selectedRoute.details?.pricingMismatchCount != null && selectedRoute.details.pricingMismatchCount > 0 && (
                <div
                  style={{
                    padding: 12,
                    marginBottom: 16,
                    background: "#fef3c7",
                    border: "1px solid #f59e0b",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#92400e",
                  }}
                >
                  Pricing mismatch: {selectedRoute.details.pricingMismatchCount} candidate(s) have predicted vs registry divergence.
                </div>
              )}
              {selectedRoute.details?.routingCandidates && selectedRoute.details.routingCandidates.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Candidates</div>
                  <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                    <table style={opsStyles.table}>
                      <thead>
                        <tr>
                          <th style={opsStyles.th}>modelId</th>
                          <th style={opsStyles.th}>pass</th>
                          <th style={{ ...opsStyles.th, textAlign: "right" }}>predictedCostUSD</th>
                          <th style={{ ...opsStyles.th, textAlign: "right" }}>predictedQuality</th>
                          <th style={opsStyles.th}>disqualifiedReason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRoute.details.routingCandidates.map((c, i) => (
                          <tr key={i}>
                            <td style={opsStyles.td}>{c.modelId}</td>
                            <td style={opsStyles.td}>{c.passed ? "✓" : "✗"}</td>
                            <td style={{ ...opsStyles.td, textAlign: "right" }}>${c.predictedCostUSD.toFixed(4)}</td>
                            <td style={{ ...opsStyles.td, textAlign: "right" }}>{c.predictedQuality?.toFixed(2) ?? "—"}</td>
                            <td style={{ ...opsStyles.td, fontSize: 12, color: "#64748b" }}>{c.disqualifiedReason ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {(selectedRoute.details?.routingCandidates?.some((c) => c.scoreBreakdown) || selectedRoute.details?.routingCandidates?.some((c) => c.score != null)) && (
                <details style={{ marginTop: 12 }}>
                  <summary style={opsStyles.detailsSummary}>Score details</summary>
                  <pre style={{ margin: 0, padding: 12, fontSize: 11, overflow: "auto", background: "#fafafa" }}>
                    {safeStringify(
                      selectedRoute.details?.routingCandidates?.map((c) => ({
                        modelId: c.modelId,
                        score: c.score,
                        scoreBreakdown: c.scoreBreakdown,
                      }))
                    )}
                  </pre>
                </details>
              )}
              {selectedRoute.details?.chosenPredictedCostUSD != null && (
                <details style={{ marginTop: 12 }}>
                  <summary style={opsStyles.detailsSummary}>Cost details</summary>
                  <pre style={{ margin: 0, padding: 12, fontSize: 11, overflow: "auto", background: "#fafafa" }}>
                    {safeStringify({
                      chosenPredictedCostUSD: selectedRoute.details?.chosenPredictedCostUSD,
                      pricingMismatches: selectedRoute.details?.pricingMismatches,
                    })}
                  </pre>
                </details>
              )}
            </div>
          )}
          {selectedRoute && (
            <div
              onClick={() => setSelectedRoute(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.3)",
                zIndex: 99,
              }}
            />
          )}
        </div>
      </section>

      {/* 3) QA results table */}
      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>QA results</div>
        <div style={opsStyles.sectionBody}>
          {qaResults.length > 0 ? (
            <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={opsStyles.table}>
                <thead>
                  <tr>
                    <th style={opsStyles.th}>targetPackageId</th>
                    <th style={opsStyles.th}>pass</th>
                    <th style={{ ...opsStyles.th, textAlign: "right" }}>qualityScore</th>
                  </tr>
                </thead>
                <tbody>
                  {qaResults.map((q, i) => (
                    <tr key={i}>
                      <td style={opsStyles.td}>{q.workerPackageId ?? q.packageId}</td>
                      <td style={opsStyles.td}>{q.pass ? "✓" : "✗"}</td>
                      <td style={{ ...opsStyles.td, textAlign: "right" }}>{q.qualityScore.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "#64748b", fontSize: 14 }}>No QA results.</p>
          )}
        </div>
      </section>

      {/* 4) Escalations list */}
      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Escalations</div>
        <div style={opsStyles.sectionBody}>
          {escalations > 0 && result?.escalations ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {result.escalations.map((e, i) => {
                const ev = e as { event?: { reason?: string }; policy?: string };
                const reason =
                  ev?.event && typeof ev.event === "object" && "reason" in ev.event
                    ? String((ev.event as { reason?: string }).reason ?? "—")
                    : typeof ev?.event === "string"
                      ? ev.event
                      : null;
                return (
                  <li
                    key={i}
                    style={{
                      padding: 12,
                      marginBottom: 8,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    {reason ?? safeStringify(e)}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p style={{ color: "#2e7d32", fontSize: 14 }}>No escalations.</p>
          )}
        </div>
      </section>

      {/* 5) Delivery preview (when available) */}
      <DeliveryPreview
        deliverableOutput={deliverableOutput}
        mode="full"
        title="Delivery"
        onDownloadJson={handleExportJson}
        style={{ ...opsStyles.section } as React.CSSProperties}
      />

      {/* 6) Raw JSON collapsed */}
      <details style={{ marginTop: 24, borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <summary style={opsStyles.detailsSummary}>
          <span>▶</span> Raw JSON
        </summary>
        <div style={{ padding: 20, background: "#fafafa", fontSize: 12, fontFamily: "monospace", overflow: "auto", maxHeight: 480 }}>
          <pre style={{ margin: 0 }}>{safeStringify(fullData)}</pre>
        </div>
      </details>
    </div>
  );
}
