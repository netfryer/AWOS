"use client";

import { demoStyles } from "./demoStyles";
import type { FlowStep } from "./types";

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

interface FlowVisualizerProps {
  currentStep: FlowStep | null;
  completedSteps: FlowStep[];
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

export function FlowVisualizer({ currentStep, completedSteps }: FlowVisualizerProps) {
  return (
    <section style={demoStyles.section}>
      <h2 style={demoStyles.sectionTitle}>Run flow</h2>
      <div style={demoStyles.flowRow}>
        {STEPS.map((step, i) => {
          const status = getStepStatus(step, currentStep, completedSteps);
          const stepStyle =
            status === "done"
              ? { ...demoStyles.flowStep, ...demoStyles.flowStepDone }
              : status === "active"
                ? { ...demoStyles.flowStep, ...demoStyles.flowStepActive }
                : demoStyles.flowStep;
          return (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={stepStyle}>{STEP_LABELS[step]}</span>
              {i < STEPS.length - 1 && <span style={demoStyles.flowArrow}>→</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
