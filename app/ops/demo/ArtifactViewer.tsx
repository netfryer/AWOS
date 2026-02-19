"use client";

import { demoStyles } from "./demoStyles";

interface ArtifactViewerProps {
  deliverable: unknown;
}

export function ArtifactViewer({ deliverable }: ArtifactViewerProps) {
  if (deliverable == null) {
    return (
      <section style={demoStyles.section}>
        <h2 style={demoStyles.sectionTitle}>Final deliverable</h2>
        <p style={{ fontSize: 18, color: "#64748b" }}>
          aggregation-report output will appear here after a run completes.
        </p>
      </section>
    );
  }

  return (
    <section style={demoStyles.section}>
      <h2 style={demoStyles.sectionTitle}>Final deliverable</h2>
      <div
        style={{
          padding: 24,
          background: "#f8fafc",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
          fontFamily: "monospace",
          fontSize: 16,
          overflow: "auto",
          maxHeight: 400,
        }}
      >
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(deliverable, null, 2)}
        </pre>
      </div>
    </section>
  );
}
