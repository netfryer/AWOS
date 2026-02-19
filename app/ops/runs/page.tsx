// ─── app/ops/runs/page.tsx ───────────────────────────────────────────────────
// Runs list; links to run detail page.

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";

interface RunSummary {
  runSessionId: string;
  startedAtISO: string;
  finishedAtISO?: string;
  costs?: { totalUSD?: number };
}

export default function RunsListPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/observability/kpis?window=50")
      .then((r) => r.json())
      .then((d) => {
        if (d?.runs) setRuns(d.runs);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={opsStyles.pageTitle}>Runs</h1>
      <p style={opsStyles.pageSubtitle}>
        Recent runs from observability. Click to view details.
      </p>
      {loading ? (
        <p style={{ color: "#64748b" }}>Loading…</p>
      ) : runs.length === 0 ? (
        <p style={{ color: "#64748b" }}>No runs. Run a scenario from Run or Demo.</p>
      ) : (
        <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={opsStyles.table}>
            <thead>
              <tr>
                <th style={opsStyles.th}>Run ID</th>
                <th style={opsStyles.th}>Started</th>
                <th style={{ ...opsStyles.th, textAlign: "right" }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.runSessionId}>
                  <td style={opsStyles.td}>
                    <Link href={`/ops/runs/${r.runSessionId}`} style={opsStyles.link}>
                      {r.runSessionId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td style={opsStyles.td}>
                    {r.startedAtISO ? new Date(r.startedAtISO).toLocaleString() : "—"}
                  </td>
                  <td style={{ ...opsStyles.td, textAlign: "right" }}>
                    {r.costs?.totalUSD != null ? `$${r.costs.totalUSD.toFixed(4)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
