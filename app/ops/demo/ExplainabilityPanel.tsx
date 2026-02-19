"use client";

import { opsStyles } from "../styles";
import { demoStyles } from "./demoStyles";

interface RouteDecision {
  type?: string;
  packageId?: string;
  chosenModelId?: string;
  compBreakdown?: unknown;
  routingCandidates?: Array<{ modelId: string; predictedCostUSD?: number; passed?: boolean }>;
}

interface ExplainabilityPanelProps {
  routeDecisions: RouteDecision[];
  /** When true, show full ROUTE candidate tables (Tech Mode). */
  showCandidateTables?: boolean;
}

export function ExplainabilityPanel({ routeDecisions, showCandidateTables = false }: ExplainabilityPanelProps) {
  if (routeDecisions.length === 0) {
    return (
      <section style={demoStyles.section}>
        <h2 style={demoStyles.sectionTitle}>Explainability</h2>
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>
          How each model was chosen. Run a scenario and complete routing to see decisions.
        </p>
      </section>
    );
  }

  return (
    <section style={demoStyles.section}>
      <h2 style={demoStyles.sectionTitle}>Explainability</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {routeDecisions.map((d, i) => (
          <div
            key={i}
            style={{
              ...demoStyles.card,
              marginBottom: 0,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>
              {d.packageId ?? `Package ${i + 1}`}
            </div>
            <div style={{ fontSize: 14, color: "#475569" }}>
              Chosen: <strong>{d.chosenModelId ?? "—"}</strong>
            </div>
            {showCandidateTables && d.routingCandidates && d.routingCandidates.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 14, color: "#64748b" }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Candidates</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={opsStyles.table}>
                    <thead>
                      <tr>
                        <th style={opsStyles.th}>modelId</th>
                        <th style={{ ...opsStyles.th, textAlign: "right" }}>predictedCostUSD</th>
                        <th style={{ ...opsStyles.th, textAlign: "center" }}>passed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.routingCandidates.map((c, j) => (
                        <tr key={j}>
                          <td style={opsStyles.td}>{c.modelId}</td>
                          <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>${c.predictedCostUSD?.toFixed(4) ?? "—"}</td>
                          <td style={{ ...opsStyles.td, textAlign: "center" }}>{c.passed ? "✓" : "✗"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
