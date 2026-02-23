// ─── app/ops/demo/ProgressStepper.tsx ───────────────────────────────────────
// Animated stepper: plan → package → route → execute → QA → ledger → delivery.

"use client";

import type { FlowStep, DeliveryStatus } from "./types";
import { demoStyles } from "./demoStyles";

const STEPS: FlowStep[] = [
  "plan",
  "package",
  "route",
  "execute",
  "qa",
  "ledger",
  "delivery",
];

const STEP_LABELS: Record<FlowStep, string> = {
  plan: "Plan",
  package: "Package",
  route: "Route",
  execute: "Execute",
  qa: "QA",
  ledger: "Ledger",
  delivery: "Delivery",
};

const STEP_ICONS: Record<FlowStep, string> = {
  plan: "📋",
  package: "📦",
  route: "🔀",
  execute: "⚡",
  qa: "✓",
  ledger: "📊",
  delivery: "📤",
};

export interface ProgressStepperProps {
  currentStep: FlowStep | null;
  completedSteps: FlowStep[];
  isRunning: boolean;
  asyncMode?: boolean;
  lastPollTime?: number | null;
  onCancel?: () => void;
  investorMode?: boolean;
  /** Pipeline description for parallelism context, e.g. "Strategy → 3 workers (∥) → aggregation → QA" */
  pipelineHint?: string;
  /** Delivery step status from ledger ASSEMBLY/ASSEMBLY_FAILED decisions */
  deliveryStatus?: DeliveryStatus;
}

function getStepStatus(
  step: FlowStep,
  currentStep: FlowStep | null,
  completedSteps: FlowStep[]
): "pending" | "active" | "done" {
  if (completedSteps.includes(step)) return "done";
  if (step === currentStep) return "active";
  return "pending";
}

const STEP_MIN_WIDTH = 100;

function formatDeliveryLabel(status: DeliveryStatus | undefined, step: FlowStep): string {
  if (step !== "delivery" || !status) return "";
  if (status.status === "not_started") return " (not started)";
  if (status.status === "assembled") return status.fileCount != null ? ` (${status.fileCount} files)` : "";
  if (status.status === "compile_verified") return status.fileCount != null ? ` (${status.fileCount} files ✓)` : " (✓)";
  if (status.status === "failed") return " (failed)";
  return "";
}

export function ProgressStepper({
  currentStep,
  completedSteps,
  isRunning,
  asyncMode,
  lastPollTime,
  onCancel,
  investorMode = true,
  pipelineHint,
  deliveryStatus,
}: ProgressStepperProps) {
  const stepStyle = (status: "pending" | "active" | "done") => ({
    ...demoStyles.flowStep,
    ...(status === "done" ? demoStyles.flowStepDone : status === "active" ? demoStyles.flowStepActive : {}),
    padding: "10px 16px",
    fontSize: 14,
    minWidth: STEP_MIN_WIDTH,
    textAlign: "center" as const,
  });

  return (
    <section style={demoStyles.section}>
      <h2 style={demoStyles.sectionTitle}>Run flow</h2>

      {pipelineHint && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>
          Pipeline: {pipelineHint}
        </p>
      )}

      {isRunning && asyncMode ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
            padding: 16,
            background: "#eff6ff",
            borderRadius: 8,
            border: "1px solid #bfdbfe",
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1e40af" }}>
            Running…
          </span>
          {lastPollTime != null && (
            <span style={{ fontSize: 13, color: "#64748b" }}>
              Last updated: {new Date(lastPollTime).toLocaleTimeString()}
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                ...demoStyles.btnSecondary,
                marginLeft: "auto",
              }}
            >
              Cancel poll
            </button>
          )}
        </div>
      ) : null}

      <div style={{ ...demoStyles.flowRow, marginTop: 0, gap: 8 }}>
        {STEPS.map((step, i) => {
          const status = getStepStatus(step, currentStep, completedSteps);
          const deliverySuffix = formatDeliveryLabel(deliveryStatus, step);
          return (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={stepStyle(status)}>
                {investorMode && STEP_ICONS[step]} {STEP_LABELS[step]}
                {deliverySuffix && (
                  <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.9, marginLeft: 4 }}>
                    {deliverySuffix}
                  </span>
                )}
              </span>
              {i < STEPS.length - 1 && <span style={demoStyles.flowArrow}>→</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
