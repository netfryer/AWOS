"use client";

import { useState } from "react";

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (value == null) return value;
    if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
  try {
    return JSON.stringify(obj, replacer, 2);
  } catch {
    return String(obj ?? "");
  }
}

interface DeveloperDetailsProps {
  data: unknown;
}

export function DeveloperDetails({ data }: DeveloperDetailsProps) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        marginTop: 24,
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          padding: "14px 20px",
          background: "#f1f5f9",
          cursor: "pointer",
          fontSize: 16,
          fontWeight: 500,
          color: "#475569",
        }}
      >
        {open ? "▼" : "▶"} Developer details (raw JSON)
      </summary>
      <div
        style={{
          padding: 20,
          borderTop: "1px solid #e2e8f0",
          background: "#fafafa",
          fontSize: 13,
          fontFamily: "monospace",
          overflow: "auto",
          maxHeight: 480,
        }}
      >
        <pre style={{ margin: 0 }}>{safeStringify(data)}</pre>
      </div>
    </details>
  );
}
