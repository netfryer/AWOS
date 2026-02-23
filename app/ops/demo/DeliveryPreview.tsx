// ─── app/ops/demo/DeliveryPreview.tsx ────────────────────────────────────────
// Investor-friendly deliverable preview: file tree, code blocks, copy, download.

"use client";

import { useState } from "react";
import type { DeliveryStatus } from "./types";
import { demoStyles } from "./demoStyles";

export interface DeliveryPreviewProps {
  /** Aggregation-report (or other) output string. */
  deliverableOutput: string | null | undefined;
  /** Compact mode: show ~40 lines + expand. Full mode: show ~120 lines + expand. */
  mode?: "compact" | "full";
  /** Called when Download JSON is clicked. */
  onDownloadJson?: () => void;
  /** Run session ID for Download ZIP. When set, enables ZIP download. */
  runSessionId?: string | null;
  /** Delivery status from ledger (ASSEMBLY/ASSEMBLY_FAILED). */
  deliveryStatus?: DeliveryStatus;
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

async function downloadZip(runSessionId: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(`/api/ops/runs/${encodeURIComponent(runSessionId)}/deliverable`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data?.error?.message ?? `Download failed (${res.status})`;
      return { error: msg };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deliverable-${runSessionId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Download failed" };
  }
}

function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  if (status.status === "not_started") return null;
  if (status.status === "assembled") {
    return (
      <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>
        Assembled{status.fileCount != null ? ` (${status.fileCount} files)` : ""}
      </span>
    );
  }
  if (status.status === "compile_verified") {
    return (
      <span style={{ fontSize: 13, color: "#15803d", fontWeight: 500 }}>
        Compile verified{status.fileCount != null ? ` (${status.fileCount} files)` : ""}
      </span>
    );
  }
  if (status.status === "failed") {
    return (
      <span style={{ fontSize: 13, color: "#b91c1c", fontWeight: 500 }} title={status.error}>
        Failed: {status.error}
      </span>
    );
  }
  return null;
}

export function DeliveryPreview({
  deliverableOutput,
  mode = "full",
  onDownloadJson,
  runSessionId,
  deliveryStatus,
  title = "Delivery Preview",
  style,
  directive,
}: DeliveryPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const previewLines = mode === "compact" ? PREVIEW_LINES_COMPACT : PREVIEW_LINES_FULL;

  const handleDownloadZip = async () => {
    if (!runSessionId) return;
    setZipError(null);
    setZipLoading(true);
    const { error } = await downloadZip(runSessionId);
    setZipLoading(false);
    if (error) setZipError(error);
  };

  if (!deliverableOutput || typeof deliverableOutput !== "string") {
    return (
      <section style={{ ...demoStyles.section, ...style }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: directive ? 16 : 0 }}>
          <h2 style={{ ...demoStyles.sectionTitle, marginBottom: 0 }}>{title}</h2>
          {deliveryStatus && <DeliveryStatusBadge status={deliveryStatus} />}
        </div>
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
        {runSessionId && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button
              type="button"
              disabled={zipLoading}
              onClick={handleDownloadZip}
              style={demoStyles.btnSecondary}
            >
              {zipLoading ? "Downloading…" : "Download ZIP"}
            </button>
            {zipError && <span style={{ fontSize: 13, color: "#b91c1c" }}>{zipError}</span>}
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: directive ? 16 : 0 }}>
        <h2 style={{ ...demoStyles.sectionTitle, marginBottom: 0 }}>{title}</h2>
        {deliveryStatus && <DeliveryStatusBadge status={deliveryStatus} />}
      </div>
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
          disabled={!runSessionId || zipLoading}
          onClick={handleDownloadZip}
          title={runSessionId ? "Download deliverable as ZIP" : "Run session ID required"}
          style={demoStyles.btnSecondary}
        >
          {zipLoading ? "Downloading…" : "Download ZIP"}
        </button>
        {zipError && (
          <span style={{ fontSize: 13, color: "#b91c1c" }}>{zipError}</span>
        )}
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
