// ─── app/ops/demo/DeliveryPreview.tsx ────────────────────────────────────────
// Investor-friendly deliverable preview: file tree, code blocks, copy, download.

"use client";

import { useState } from "react";
import { demoStyles } from "./demoStyles";

export interface DeliveryPreviewProps {
  /** Aggregation-report (or other) output string. */
  deliverableOutput: string | null | undefined;
  /** Compact mode: show ~40 lines + expand. Full mode: show ~120 lines + expand. */
  mode?: "compact" | "full";
  /** Called when Download JSON is clicked. */
  onDownloadJson?: () => void;
  /** Title for the section. */
  title?: string;
  /** Optional CSS. */
  style?: React.CSSProperties;
  /** The directive/prompt that produced this output. Shown above output for context. */
  directive?: string | null;
}

const PREVIEW_LINES_COMPACT = 40;
const PREVIEW_LINES_FULL = 120;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 600,
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        background: "#fff",
        color: "#475569",
        cursor: "pointer",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function DeliveryPreview({
  deliverableOutput,
  mode = "full",
  onDownloadJson,
  title = "Delivery Preview",
  style,
  directive,
}: DeliveryPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const previewLines = mode === "compact" ? PREVIEW_LINES_COMPACT : PREVIEW_LINES_FULL;

  if (!deliverableOutput || typeof deliverableOutput !== "string") {
    return (
      <section style={{ ...demoStyles.section, ...style }}>
        <h2 style={demoStyles.sectionTitle}>{title}</h2>
        {directive && (
          <div
            style={{
              padding: 12,
              marginBottom: 16,
              background: "#f8fafc",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 14,
              color: "#334155",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Building
            </div>
            <div style={{ fontStyle: "italic" }}>{directive}</div>
          </div>
        )}
        <div style={{ padding: 24, background: "#f8fafc", borderRadius: 8, fontSize: 14, color: "#64748b" }}>
          Run a scenario to see the AI-generated deliverable here. Output appears when a run completes.
        </div>
      </section>
    );
  }

  const fullText = deliverableOutput;
  const lines = fullText.split("\n");
  const shouldTruncate = !expanded && lines.length > previewLines;
  const displayText = shouldTruncate ? lines.slice(0, previewLines).join("\n") + "\n…" : fullText;

  return (
    <section style={{ ...demoStyles.section, ...style }}>
      <h2 style={demoStyles.sectionTitle}>{title}</h2>
      {directive && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: "#f8fafc",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: 14,
            color: "#334155",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Building
          </div>
          <div style={{ fontStyle: "italic" }}>{directive}</div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
        {onDownloadJson && (
          <button type="button" onClick={onDownloadJson} style={demoStyles.btnSecondary}>
            Download JSON
          </button>
        )}
        <button
          type="button"
          disabled
          title="Download ZIP (coming soon)"
          style={{
            ...demoStyles.btnSecondary,
            opacity: 0.6,
            cursor: "not-allowed",
          }}
        >
          Download ZIP
        </button>
      </div>

      <div style={{ position: "relative" }}>
        <pre
          style={{
            margin: 0,
            padding: 16,
            paddingTop: 44,
            background: "#fafafa",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "monospace",
            overflow: "auto",
            maxHeight: mode === "compact" ? 320 : 480,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            border: "1px solid #e2e8f0",
          }}
        >
          <code>{displayText}</code>
        </pre>
        <CopyButton text={fullText} />
        {shouldTruncate && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              ...demoStyles.btnSecondary,
              marginTop: 12,
            }}
          >
            Expand ({lines.length - previewLines} more lines)
          </button>
        )}
        {expanded && lines.length > previewLines && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              ...demoStyles.btnSecondary,
              marginTop: 12,
            }}
          >
            Collapse
          </button>
        )}
      </div>
    </section>
  );
}
