// ─── app/ops/demo/ModeToggle.tsx ────────────────────────────────────────────
// Investor Mode (default ON): hides JSON, enlarges typography.
// Tech Mode: reveals explainability tables, raw JSON.

"use client";

export interface ModeToggleProps {
  investorMode: boolean;
  techMode: boolean;
  onInvestorModeChange: (v: boolean) => void;
  onTechModeChange: (v: boolean) => void;
  compact?: boolean;
}

export function ModeToggle({
  investorMode,
  techMode,
  onInvestorModeChange,
  onTechModeChange,
  compact,
}: ModeToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: compact ? 12 : 20,
        padding: compact ? "8px 12px" : "12px 20px",
        background: "#f8fafc",
        borderRadius: 8,
        border: "1px solid #e2e8f0",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          fontSize: compact ? 14 : 16,
          fontWeight: 500,
          color: "#334155",
        }}
      >
        <input
          type="checkbox"
          checked={investorMode}
          onChange={(e) => onInvestorModeChange(e.target.checked)}
        />
        <span>Investor Mode</span>
        <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}>
          (projector-friendly)
        </span>
      </label>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          fontSize: compact ? 14 : 16,
          fontWeight: 500,
          color: "#334155",
        }}
      >
        <input
          type="checkbox"
          checked={techMode}
          onChange={(e) => onTechModeChange(e.target.checked)}
        />
        <span>Tech Mode</span>
        <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}>
          (JSON, candidate tables)
        </span>
      </label>
    </div>
  );
}
