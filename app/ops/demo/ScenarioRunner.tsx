"use client";

import { demoStyles } from "./demoStyles";
import { DEMO_PRESETS } from "./presets";
import type { DemoPresetId } from "./types";
import type { TierProfile } from "./types";

interface ScenarioRunnerProps {
  presetId: DemoPresetId | null;
  projectBudgetUSD: number;
  tierProfile: TierProfile;
  concurrencyWorker: number;
  concurrencyQa: number;
  async: boolean;
  onPresetChange: (id: DemoPresetId | null) => void;
  onProjectBudgetUSDChange: (v: number) => void;
  onTierProfileChange: (v: TierProfile) => void;
  onConcurrencyWorkerChange: (v: number) => void;
  onConcurrencyQaChange: (v: number) => void;
  onAsyncChange: (v: boolean) => void;
  onRun: () => void;
  onLoadLastRun: () => void;
  loading: boolean;
  hasLastRun: boolean;
}


export function ScenarioRunner({
  presetId,
  projectBudgetUSD,
  tierProfile,
  concurrencyWorker,
  concurrencyQa,
  async: asyncMode,
  onPresetChange,
  onProjectBudgetUSDChange,
  onTierProfileChange,
  onConcurrencyWorkerChange,
  onConcurrencyQaChange,
  onAsyncChange,
  onRun,
  onLoadLastRun,
  loading,
  hasLastRun,
}: ScenarioRunnerProps) {
  return (
    <section style={demoStyles.section}>
      <h2 style={demoStyles.sectionTitle}>Scenario</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          <div>
            <label style={{ ...demoStyles.cardLabel, marginBottom: 6, display: "block" }}>
              Scenario
            </label>
            <select
              value={presetId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onPresetChange((v ? (v as DemoPresetId) : null));
              }}
              style={demoStyles.select}
            >
              <option value="">— Select preset —</option>
              {DEMO_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ ...demoStyles.cardLabel, marginBottom: 6, display: "block" }}>
              Budget (USD)
            </label>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: 8, backgroundColor: "#fff" }}>
              <span style={{ padding: "10px 0 10px 14px", fontSize: 14, color: "#64748b" }}>$</span>
              <input
                type="number"
                min={1}
                step={0.01}
                value={projectBudgetUSD}
                onChange={(e) => onProjectBudgetUSDChange(Math.max(1, Number(e.target.value) || 1))}
                style={{ ...demoStyles.input, border: "none", width: 70, paddingLeft: 4 }}
              />
            </div>
          </div>

          <div>
            <label style={{ ...demoStyles.cardLabel, marginBottom: 6, display: "block" }}>
              Tier
            </label>
            <select
              value={tierProfile}
              onChange={(e) => onTierProfileChange(e.target.value as TierProfile)}
              style={demoStyles.select}
            >
              <option value="cheap">cheap</option>
              <option value="standard">standard</option>
              <option value="premium">premium</option>
            </select>
          </div>

          <div>
            <label style={{ ...demoStyles.cardLabel, marginBottom: 6, display: "block" }}>
              Concurrency (worker)
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={concurrencyWorker}
              onChange={(e) => onConcurrencyWorkerChange(Number(e.target.value) || 1)}
              style={demoStyles.input}
            />
          </div>

          <div>
            <label style={{ ...demoStyles.cardLabel, marginBottom: 6, display: "block" }}>
              Concurrency (QA)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={concurrencyQa}
              onChange={(e) => onConcurrencyQaChange(Number(e.target.value) || 1)}
              style={demoStyles.input}
            />
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                color: "#475569",
              }}
            >
              <input
                type="checkbox"
                checked={asyncMode}
                onChange={(e) => onAsyncChange(e.target.checked)}
              />
              Async
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={onRun}
            disabled={!presetId || loading}
            style={{
              ...demoStyles.btnPrimary,
              opacity: !presetId || loading ? 0.6 : 1,
              cursor: !presetId || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Running…" : "Run"}
          </button>
          {hasLastRun && (
            <button
              type="button"
              onClick={onLoadLastRun}
              disabled={loading}
              style={{
                ...demoStyles.btnSecondary,
                opacity: loading ? 0.6 : 1,
              }}
            >
              Load last run
            </button>
          )}
        </div>

        {presetId && (() => {
          const preset = DEMO_PRESETS.find((p) => p.id === presetId);
          if (!preset) return null;
          return (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: "0 0 8px", fontSize: 14, color: "#64748b" }}>
                {preset.description}
              </p>
              <div
                style={{
                  padding: 12,
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 14,
                  color: "#334155",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Prompt / Directive
                </div>
                <div style={{ fontStyle: "italic" }}>{preset.directive}</div>
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
