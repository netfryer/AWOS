"use client";

import { demoStyles } from "./demoStyles";

interface SummaryCardsProps {
  cost?: number;
  durationSeconds?: number;
  packageCount?: number;
  workerCount?: number;
  qaCount?: number;
  escalations?: number;
}

export function SummaryCards({
  cost,
  durationSeconds,
  packageCount,
  workerCount,
  qaCount,
  escalations,
}: SummaryCardsProps) {
  const hasData =
    cost != null ||
    durationSeconds != null ||
    packageCount != null ||
    workerCount != null ||
    qaCount != null ||
    escalations != null;

  if (!hasData) {
    return (
      <section style={demoStyles.section}>
        <h2 style={demoStyles.sectionTitle}>Results</h2>
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>Run a scenario to see cost, duration, and metrics here.</p>
      </section>
    );
  }

  return (
    <section style={demoStyles.section}>
      <h2 style={demoStyles.sectionTitle}>Results</h2>
      <div style={demoStyles.cardGrid}>
        {cost != null && (
          <div style={demoStyles.card}>
            <div style={demoStyles.cardLabel}>Cost</div>
            <div style={demoStyles.cardValue}>${cost.toFixed(4)}</div>
          </div>
        )}
        {durationSeconds != null && (
          <div style={demoStyles.card}>
            <div style={demoStyles.cardLabel}>Duration</div>
            <div style={demoStyles.cardValue}>{durationSeconds}s</div>
          </div>
        )}
        {packageCount != null && (
          <div style={demoStyles.card}>
            <div style={demoStyles.cardLabel}>Packages</div>
            <div style={demoStyles.cardValue}>{packageCount}</div>
          </div>
        )}
        {workerCount != null && (
          <div style={demoStyles.card}>
            <div style={demoStyles.cardLabel}>Workers</div>
            <div style={demoStyles.cardValue}>{workerCount}</div>
          </div>
        )}
        {qaCount != null && (
          <div style={demoStyles.card}>
            <div style={demoStyles.cardLabel}>QA</div>
            <div style={demoStyles.cardValue}>{qaCount}</div>
          </div>
        )}
        {escalations != null && (
          <div style={demoStyles.card}>
            <div style={demoStyles.cardLabel}>Escalations</div>
            <div style={demoStyles.cardValue}>{escalations}</div>
          </div>
        )}
      </div>
    </section>
  );
}
