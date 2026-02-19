// Demo mode styles: projector-friendly, large typography, spacious layout.
// Aligned with ops design tokens; scales up for investor mode.

import type { CSSProperties } from "react";

const radius = 8;
const space = 24;

export const demoStyles: Record<string, CSSProperties> = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 16,
    lineHeight: 1.5,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: "#1e293b",
    margin: 0,
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 16,
    color: "#64748b",
    margin: 0,
  },
  section: {
    background: "#fff",
    borderRadius: radius,
    border: "1px solid #e2e8f0",
    padding: space,
    marginBottom: space,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: "#334155",
    marginBottom: 16,
    marginTop: 0,
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: space,
  },
  card: {
    padding: space,
    background: "#f8fafc",
    borderRadius: radius,
    border: "1px solid #e2e8f0",
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: 700,
    color: "#1e293b",
  },
  flowRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    flexDirection: "row",
  },
  flowStep: {
    padding: "10px 18px",
    borderRadius: radius,
    background: "#e2e8f0",
    color: "#475569",
    fontSize: 14,
    fontWeight: 500,
  },
  flowStepActive: {
    background: "#1976d2",
    color: "#fff",
  },
  flowStepDone: {
    background: "#2e7d32",
    color: "#fff",
  },
  flowArrow: {
    color: "#94a3b8",
    fontSize: 16,
  },
  btnPrimary: {
    padding: "12px 24px",
    fontSize: 16,
    fontWeight: 600,
    borderRadius: radius,
    border: "none",
    cursor: "pointer",
    background: "#7b1fa2",
    color: "#fff",
  },
  btnSecondary: {
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 500,
    borderRadius: radius,
    border: "1px solid #cbd5e1",
    cursor: "pointer",
    background: "#fff",
    color: "#475569",
  },
  select: {
    padding: "10px 14px",
    fontSize: 14,
    border: "1px solid #cbd5e1",
    borderRadius: radius,
    backgroundColor: "#fff",
    color: "#334155",
  },
  input: {
    padding: "10px 14px",
    fontSize: 14,
    border: "1px solid #cbd5e1",
    borderRadius: radius,
    backgroundColor: "#fff",
    color: "#334155",
    width: 80,
  },
};
