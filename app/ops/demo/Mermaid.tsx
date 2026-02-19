// ─── app/ops/demo/Mermaid.tsx ───────────────────────────────────────────────
// Renders Mermaid diagrams via CDN script. No npm deps. Graceful fallback to source.

"use client";

import { useState, useEffect, useCallback, useId } from "react";

const MERMAID_CDN = "https://unpkg.com/mermaid@10/dist/mermaid.min.js";

declare global {
  interface Window {
    mermaid?: {
      initialize: (config: { startOnLoad?: boolean; theme?: string }) => void;
      render: (id: string, code: string) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
    };
  }
}

let mermaidLoadPromise: Promise<void> | null = null;

function loadMermaid(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.mermaid) return Promise.resolve();
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MERMAID_CDN;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Mermaid script failed"));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}

export interface MermaidProps {
  code: string;
  /** Optional container styles */
  style?: React.CSSProperties;
  /** Show "Copy Mermaid source" button */
  showCopyButton?: boolean;
}

export function Mermaid({ code, style, showCopyButton = true }: MermaidProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const uniqueId = useId().replace(/:/g, "-");
  const diagramId = `mermaid-${uniqueId}`;

  const copySource = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => {},
      () => {}
    );
  }, [code]);

  useEffect(() => {
    if (!code?.trim()) {
      setLoading(false);
      setError(true);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        await loadMermaid();
        if (cancelled) return;
        const m = window.mermaid;
        if (!m) {
          setError(true);
          setLoading(false);
          return;
        }
        m.initialize({ startOnLoad: false, theme: "default" });
        const { svg: result } = await m.render(diagramId, code.trim());
        if (cancelled) return;
        setSvg(result);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [code, diagramId]);

  const containerStyle: React.CSSProperties = {
    position: "relative",
    padding: 16,
    background: "#fafafa",
    borderRadius: 8,
    overflow: "auto",
    minHeight: 120,
    ...style,
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ color: "#64748b", fontSize: 14 }}>Rendering diagram…</div>
      </div>
    );
  }

  if (error || !svg) {
    return (
      <div style={containerStyle}>
        {showCopyButton && (
          <button
            type="button"
            onClick={copySource}
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
            Copy Mermaid source
          </button>
        )}
        <pre
          style={{
            margin: 0,
            paddingTop: showCopyButton ? 40 : 0,
            fontSize: 12,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {showCopyButton && (
        <button
          type="button"
          onClick={copySource}
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
          Copy Mermaid source
        </button>
      )}
      <div
        style={{ paddingTop: showCopyButton ? 40 : 0 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
