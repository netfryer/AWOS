// ─── app/ops/model-hr/page.tsx ─────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";

type ModelStatus = "active" | "probation" | "deprecated" | "disabled";

interface ModelRegistryEntry {
  id: string;
  identity: {
    provider: string;
    modelId: string;
    status: ModelStatus;
    disabledReason?: string;
  };
  displayName?: string;
  pricing: { inPer1k: number; outPer1k: number; currency?: string };
  governance?: { allowedTiers?: string[] };
  expertise?: Record<string, number>;
  reliability?: number;
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={opsStyles.section}>
      <div style={opsStyles.sectionHeader}>{title}</div>
      <div style={opsStyles.sectionBody}>{children}</div>
    </section>
  );
}

function DisableModal({
  modelId,
  onClose,
  onConfirm,
}: {
  modelId: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          minWidth: 320,
          maxWidth: 400,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          Disable model: {modelId}
        </div>
        <label style={opsStyles.label}>Reason (required)</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Deprecated, cost regression"
          style={{ ...opsStyles.input, marginBottom: 16 }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={opsStyles.btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (reason.trim()) {
                onConfirm(reason.trim());
                onClose();
              }
            }}
            disabled={!reason.trim()}
            style={{
              ...opsStyles.btnPrimary,
              opacity: reason.trim() ? 1 : 0.5,
              cursor: reason.trim() ? "pointer" : "not-allowed",
            }}
          >
            Disable
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModelPerformancePrior {
  taskType: string;
  difficulty: string;
  qualityPrior: number;
  costMultiplier: number;
  sampleCount: number;
  lastUpdatedISO: string;
  defectRate?: number;
}

interface ModelObservation {
  tsISO: string;
  taskType: string;
  difficulty: string;
  actualCostUSD: number;
  predictedCostUSD: number;
  actualQuality: number;
  predictedQuality: number;
}

interface ModelHrSignal {
  tsISO: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  sampleCount?: number;
}

interface ModelHrAnalytics {
  success: boolean;
  windowHours: number;
  registry: { health: "OK" | "FALLBACK"; fallbackCount: number };
  routing: {
    totalRoutes: number;
    enforceCheapestViableRate: number;
    chosenIsCheapestViableRate: number;
    pricingMismatchRoutes: number;
  };
  cost: {
    avgVarianceRatio: number;
    p80VarianceRatio: number;
    totalActualUSD: number;
    totalPredictedUSD: number;
  };
  quality: {
    avgActualQuality: number;
    avgPredictedQuality: number;
    calibrationError: number;
  };
  escalations: {
    count: number;
    byReason: Record<string, number>;
    topModels: { modelId: string; count: number }[];
  };
  models: { active: number; probation: number; deprecated: number; disabled: number };
}

export default function OpsModelHRPage() {
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterProvider, setFilterProvider] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [disableModalFor, setDisableModalFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [priors, setPriors] = useState<ModelPerformancePrior[]>([]);
  const [observations, setObservations] = useState<ModelObservation[]>([]);
  const [signals, setSignals] = useState<ModelHrSignal[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [registryHealth, setRegistryHealth] = useState<{ status: "OK" | "FALLBACK" | "UNKNOWN"; fallbackCount24h: number } | null>(null);
  const [analytics, setAnalytics] = useState<ModelHrAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsWindowHours, setAnalyticsWindowHours] = useState(24);

  const fetchRegistryHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/model-hr/health");
      const data = await res.json();
      setRegistryHealth({
        status: (data.registryHealth === "FALLBACK" ? "FALLBACK" : data.registryHealth === "UNKNOWN" ? "UNKNOWN" : "OK") as "OK" | "FALLBACK" | "UNKNOWN",
        fallbackCount24h: data.fallbackCount24h ?? 0,
      });
    } catch {
      setRegistryHealth({ status: "UNKNOWN", fallbackCount24h: 0 });
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`/api/ops/model-hr/analytics?windowHours=${analyticsWindowHours}`);
      const data = await res.json();
      if (data.success) setAnalytics(data);
      else setAnalytics(null);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsWindowHours]);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (includeDisabled) params.set("includeDisabled", "true");
      if (filterProvider) params.set("provider", filterProvider);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`/api/ops/model-hr/registry?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setModels(data.models ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [filterProvider, filterStatus, includeDisabled]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    fetchRegistryHealth();
  }, [fetchRegistryHealth]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    if (!selectedModelId) {
      setPriors([]);
      setObservations([]);
      setSignals([]);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    const base = `/api/ops/model-hr/registry/${encodeURIComponent(selectedModelId)}`;
    Promise.all([
      fetch(`${base}/priors`).then((r) => r.json()),
      fetch(`${base}/observations?limit=50`).then((r) => r.json()),
      fetch(`${base}/signals?limit=50`).then((r) => r.json()),
    ]).then(([pRes, oRes, sRes]) => {
      if (cancelled) return;
      setPriors(pRes.priors ?? []);
      setObservations(oRes.observations ?? []);
      setSignals(sRes.signals ?? []);
      setDetailsLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setPriors([]);
        setObservations([]);
        setSignals([]);
        setDetailsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedModelId]);

  async function setStatus(modelId: string, status: "active" | "probation") {
    setActionError(null);
    setActionLoading((l) => ({ ...l, [modelId]: true }));
    try {
      const res = await fetch(`/api/ops/model-hr/registry/${encodeURIComponent(modelId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Set status failed");
      setModels((prev) =>
        prev.map((m) =>
          m.id === modelId
            ? { ...m, identity: { ...m.identity, status } }
            : m
        )
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Set status failed");
    } finally {
      setActionLoading((l) => ({ ...l, [modelId]: false }));
    }
  }

  async function disableModel(modelId: string, reason: string) {
    setActionError(null);
    setDisableModalFor(null);
    setActionLoading((l) => ({ ...l, [modelId]: true }));
    try {
      const res = await fetch(`/api/ops/model-hr/registry/${encodeURIComponent(modelId)}/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Disable failed");
      setModels((prev) =>
        prev.map((m) =>
          m.id === modelId
            ? {
                ...m,
                identity: {
                  ...m.identity,
                  status: "disabled" as ModelStatus,
                  disabledReason: reason,
                },
              }
            : m
        )
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Disable failed");
    } finally {
      setActionLoading((l) => ({ ...l, [modelId]: false }));
    }
  }

  const providers = [...new Set(models.map((m) => m.identity.provider))].sort();

  return (
    <div style={opsStyles.spaceY}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={opsStyles.pageTitle}>Model HR</h1>
          <p style={opsStyles.pageSubtitle}>
            Manage model registry: status, disable, add/update models
          </p>
        </div>
        <Link href="/ops/model-hr/actions" style={opsStyles.btnSecondary}>
          Actions Queue
        </Link>
      </div>

      {(error || actionError) && (
        <div style={opsStyles.error}>{error ?? actionError}</div>
      )}

      {registryHealth != null && (
        <Panel title="Registry Health">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span
              style={{
                fontWeight: 600,
                color:
                  registryHealth.status === "FALLBACK"
                    ? "#b45309"
                    : registryHealth.status === "UNKNOWN"
                      ? "#64748b"
                      : "#059669",
              }}
            >
              {registryHealth.status}
            </span>
            {registryHealth.fallbackCount24h > 0 && (
              <span style={{ fontSize: 13, color: "#64748b" }}>
                Fallback used {registryHealth.fallbackCount24h} time(s) in last 24h
              </span>
            )}
            <button
              onClick={fetchRegistryHealth}
              style={opsStyles.btnSecondary}
            >
              Refresh
            </button>
          </div>
        </Panel>
      )}

      <Panel title="Analytics Summary">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <label style={opsStyles.label}>Window (hours)</label>
          <select
            value={analyticsWindowHours}
            onChange={(e) => setAnalyticsWindowHours(parseInt(e.target.value, 10) || 24)}
            style={opsStyles.select}
          >
            <option value={1}>1</option>
            <option value={6}>6</option>
            <option value={24}>24</option>
            <option value={72}>72</option>
            <option value={168}>168</option>
          </select>
          <button onClick={fetchAnalytics} disabled={analyticsLoading} style={opsStyles.btnSecondary}>
            {analyticsLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {analytics ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            <div style={opsStyles.card}>
              <div style={opsStyles.label}>Registry</div>
              <div style={{ fontWeight: 600, color: analytics.registry.health === "FALLBACK" ? "#b45309" : "#059669" }}>
                {analytics.registry.health}
              </div>
              <div style={opsStyles.muted}>Fallbacks: {analytics.registry.fallbackCount}</div>
            </div>
            <div style={opsStyles.card}>
              <div style={opsStyles.label}>Routing</div>
              <div style={{ fontWeight: 600 }}>{analytics.routing.totalRoutes} routes</div>
              <div style={opsStyles.muted}>
                Enforce cheapest: {(analytics.routing.enforceCheapestViableRate * 100).toFixed(1)}%
              </div>
              <div style={opsStyles.muted}>
                Chosen cheapest: {(analytics.routing.chosenIsCheapestViableRate * 100).toFixed(1)}%
              </div>
              <div style={opsStyles.muted}>Pricing mismatch: {analytics.routing.pricingMismatchRoutes}</div>
            </div>
            <div style={opsStyles.card}>
              <div style={opsStyles.label}>Cost</div>
              <div style={{ fontWeight: 600 }}>Avg variance: {analytics.cost.avgVarianceRatio.toFixed(3)}</div>
              <div style={opsStyles.muted}>P80: {analytics.cost.p80VarianceRatio.toFixed(3)}</div>
              <div style={opsStyles.muted}>
                Actual: ${analytics.cost.totalActualUSD.toFixed(2)} / Pred: ${analytics.cost.totalPredictedUSD.toFixed(2)}
              </div>
            </div>
            <div style={opsStyles.card}>
              <div style={opsStyles.label}>Quality</div>
              <div style={{ fontWeight: 600 }}>Actual: {analytics.quality.avgActualQuality.toFixed(3)}</div>
              <div style={opsStyles.muted}>Predicted: {analytics.quality.avgPredictedQuality.toFixed(3)}</div>
              <div style={opsStyles.muted}>Calibration error: {analytics.quality.calibrationError.toFixed(3)}</div>
            </div>
            <div style={opsStyles.card}>
              <div style={opsStyles.label}>Escalations</div>
              <div style={{ fontWeight: 600 }}>{analytics.escalations.count}</div>
              {Object.keys(analytics.escalations.byReason).length > 0 && (
                <div style={opsStyles.muted}>
                  {Object.entries(analytics.escalations.byReason)
                    .map(([r, c]) => `${r}: ${c}`)
                    .join(", ")}
                </div>
              )}
              {analytics.escalations.topModels.length > 0 && (
                <div style={{ ...opsStyles.muted, marginTop: 4 }}>
                  Top: {analytics.escalations.topModels.slice(0, 3).map((m) => `${m.modelId}(${m.count})`).join(", ")}
                </div>
              )}
            </div>
            <div style={opsStyles.card}>
              <div style={opsStyles.label}>Models</div>
              <div style={{ fontWeight: 600 }}>
                Active: {analytics.models.active} / Probation: {analytics.models.probation}
              </div>
              <div style={opsStyles.muted}>
                Deprecated: {analytics.models.deprecated} / Disabled: {analytics.models.disabled}
              </div>
            </div>
          </div>
        ) : !analyticsLoading ? (
          <div style={opsStyles.muted}>No analytics data. Click Refresh to fetch.</div>
        ) : null}
      </Panel>

      <Panel title="Filters">
        <div style={opsStyles.flexRow}>
          <div>
            <label style={opsStyles.label}>Provider</label>
            <input
              type="text"
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              placeholder="e.g. openai"
              list="provider-list"
              style={{ ...opsStyles.input, width: 140 }}
            />
            <datalist id="provider-list">
              {providers.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={opsStyles.label}>Status</label>
            <select
              value={filterStatus}
              onChange={(e) => {
                const v = e.target.value;
                setFilterStatus(v);
                if (v === "disabled") setIncludeDisabled(true);
              }}
              style={opsStyles.select}
            >
              <option value="">All</option>
              <option value="active">active</option>
              <option value="probation">probation</option>
              <option value="deprecated">deprecated</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}>
            <input
              type="checkbox"
              checked={includeDisabled}
              onChange={(e) => setIncludeDisabled(e.target.checked)}
            />
            <span style={{ fontSize: 13, color: "#475569" }}>Include disabled</span>
          </label>
          <button
            onClick={fetchModels}
            disabled={loading}
            style={{ ...opsStyles.btnSecondary, marginTop: 20 }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </Panel>

      <Panel title="Models">
        {loading ? (
          <div style={opsStyles.muted}>Loading models...</div>
        ) : models.length === 0 ? (
          <div style={opsStyles.muted}>No models match filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={opsStyles.table}>
              <thead>
                <tr>
                  <th style={opsStyles.th}>ID</th>
                  <th style={opsStyles.th}>Provider</th>
                  <th style={opsStyles.th}>Status</th>
                  <th style={opsStyles.th}>Allowed Tiers</th>
                  <th style={opsStyles.th}>Pricing (in/out)</th>
                  <th style={opsStyles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    style={{
                      cursor: "pointer",
                      background: selectedModelId === m.id ? "#eff6ff" : undefined,
                    }}
                  >
                    <td style={opsStyles.td}>
                      <strong>{m.id}</strong>
                      {m.displayName && (
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {m.displayName}
                        </div>
                      )}
                    </td>
                    <td style={opsStyles.td}>{m.identity.provider}</td>
                    <td style={opsStyles.td}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500,
                          background:
                            m.identity.status === "disabled"
                              ? "#fee2e2"
                              : m.identity.status === "probation"
                                ? "#fef3c7"
                                : m.identity.status === "deprecated"
                                  ? "#f3f4f6"
                                  : "#dcfce7",
                          color:
                            m.identity.status === "disabled"
                              ? "#b91c1c"
                              : m.identity.status === "probation"
                                ? "#b45309"
                                : m.identity.status === "deprecated"
                                  ? "#6b7280"
                                  : "#15803d",
                        }}
                      >
                        {m.identity.status}
                      </span>
                      {m.identity.disabledReason && (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                          {m.identity.disabledReason}
                        </div>
                      )}
                    </td>
                    <td style={opsStyles.td}>
                      {(m.governance?.allowedTiers ?? []).length > 0
                        ? m.governance!.allowedTiers!.join(", ")
                        : "—"}
                    </td>
                    <td style={opsStyles.td}>
                      {m.pricing.inPer1k.toFixed(4)} / {m.pricing.outPer1k.toFixed(4)}
                    </td>
                    <td style={opsStyles.td} onClick={(e) => e.stopPropagation()}>
                      {m.identity.status !== "disabled" && (
                        <div style={opsStyles.flexGap}>
                          <select
                            value={m.identity.status}
                            onChange={(e) => {
                              const v = e.target.value as "active" | "probation";
                              if (v === "active" || v === "probation") setStatus(m.id, v);
                            }}
                            disabled={actionLoading[m.id]}
                            style={{ ...opsStyles.select, minWidth: 100 }}
                          >
                            <option value="active">active</option>
                            <option value="probation">probation</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setDisableModalFor(m.id)}
                            disabled={actionLoading[m.id]}
                            style={{
                              ...opsStyles.btnSecondary,
                              color: "#b91c1c",
                              borderColor: "#fca5a5",
                            }}
                          >
                            Disable
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selectedModelId && (
        <Panel title={`Model details: ${selectedModelId}`}>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={opsStyles.muted}>Performance priors, observations, and signals</span>
            <button
              type="button"
              onClick={() => setSelectedModelId(null)}
              style={opsStyles.btnSecondary}
            >
              Close
            </button>
          </div>
          {detailsLoading ? (
            <div style={opsStyles.muted}>Loading details...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              <div>
                <div style={{ ...opsStyles.sectionHeader, marginBottom: 12 }}>Performance priors (by taskType+difficulty)</div>
                {priors.length === 0 ? (
                  <div style={opsStyles.muted}>No priors</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={opsStyles.table}>
                      <thead>
                        <tr>
                          <th style={opsStyles.th}>taskType</th>
                          <th style={opsStyles.th}>difficulty</th>
                          <th style={opsStyles.th}>qualityPrior</th>
                          <th style={opsStyles.th}>costMultiplier</th>
                          <th style={opsStyles.th}>sampleCount</th>
                          <th style={opsStyles.th}>defectRate</th>
                          <th style={opsStyles.th}>lastUpdatedISO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {priors.map((p, i) => (
                          <tr key={`${p.taskType}-${p.difficulty}-${i}`}>
                            <td style={opsStyles.td}>{p.taskType}</td>
                            <td style={opsStyles.td}>{p.difficulty}</td>
                            <td style={opsStyles.td}>{p.qualityPrior}</td>
                            <td style={opsStyles.td}>{p.costMultiplier}</td>
                            <td style={opsStyles.td}>{p.sampleCount}</td>
                            <td style={opsStyles.td}>{p.defectRate != null ? p.defectRate.toFixed(3) : "—"}</td>
                            <td style={opsStyles.td}>{p.lastUpdatedISO}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <div style={{ ...opsStyles.sectionHeader, marginBottom: 12 }}>Recent observations (last 50)</div>
                {observations.length === 0 ? (
                  <div style={opsStyles.muted}>No observations</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={opsStyles.table}>
                      <thead>
                        <tr>
                          <th style={opsStyles.th}>tsISO</th>
                          <th style={opsStyles.th}>taskType</th>
                          <th style={opsStyles.th}>difficulty</th>
                          <th style={opsStyles.th}>actualCostUSD</th>
                          <th style={opsStyles.th}>predictedCostUSD</th>
                          <th style={opsStyles.th}>actualQuality</th>
                          <th style={opsStyles.th}>predictedQuality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {observations.map((o, i) => (
                          <tr key={`${o.tsISO}-${i}`}>
                            <td style={opsStyles.td}>{o.tsISO}</td>
                            <td style={opsStyles.td}>{o.taskType}</td>
                            <td style={opsStyles.td}>{o.difficulty}</td>
                            <td style={opsStyles.td}>{o.actualCostUSD}</td>
                            <td style={opsStyles.td}>{o.predictedCostUSD}</td>
                            <td style={opsStyles.td}>{o.actualQuality}</td>
                            <td style={opsStyles.td}>{o.predictedQuality}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <div style={{ ...opsStyles.sectionHeader, marginBottom: 12 }}>Recent signals (last 50, filtered to this model)</div>
                {signals.length === 0 ? (
                  <div style={opsStyles.muted}>No signals</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={opsStyles.table}>
                      <thead>
                        <tr>
                          <th style={opsStyles.th}>tsISO</th>
                          <th style={opsStyles.th}>previousStatus</th>
                          <th style={opsStyles.th}>newStatus</th>
                          <th style={opsStyles.th}>reason</th>
                          <th style={opsStyles.th}>sampleCount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.map((s, i) => (
                          <tr key={`${s.tsISO}-${i}`}>
                            <td style={opsStyles.td}>{s.tsISO}</td>
                            <td style={opsStyles.td}>{s.previousStatus}</td>
                            <td style={opsStyles.td}>{s.newStatus}</td>
                            <td style={opsStyles.td}>{s.reason}</td>
                            <td style={opsStyles.td}>{s.sampleCount ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </Panel>
      )}

      <AddUpdateModelForm onSuccess={fetchModels} />

      {disableModalFor && (
        <DisableModal
          modelId={disableModalFor}
          onClose={() => setDisableModalFor(null)}
          onConfirm={(reason) => disableModel(disableModalFor, reason)}
        />
      )}
    </div>
  );
}

function AddUpdateModelForm({ onSuccess }: { onSuccess: () => void }) {
  const [id, setId] = useState("");
  const [provider, setProvider] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inPer1k, setInPer1k] = useState("");
  const [outPer1k, setOutPer1k] = useState("");
  const [allowedTiers, setAllowedTiers] = useState("");
  const [reliability, setReliability] = useState("");
  const [expertise, setExpertise] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const inVal = parseFloat(inPer1k);
    const outVal = parseFloat(outPer1k);
    if (!id.trim() || !provider.trim()) {
      setFormError("ID and provider are required");
      return;
    }
    if (isNaN(inVal) || isNaN(outVal) || inVal < 0 || outVal < 0) {
      setFormError("Pricing must be non-negative numbers");
      return;
    }
    setLoading(true);
    try {
      const expertiseObj: Record<string, number> = {};
      if (expertise.trim()) {
        for (const part of expertise.split(",")) {
          const [k, v] = part.split(":").map((s) => s.trim());
          if (k && v) {
            const num = parseFloat(v);
            if (!isNaN(num)) expertiseObj[k] = num;
          }
        }
      }
      const body = {
        id: id.trim(),
        identity: {
          provider: provider.trim(),
          modelId: id.trim(),
          status: "active",
        },
        displayName: displayName.trim() || undefined,
        pricing: { inPer1k: inVal, outPer1k: outVal, currency: "USD" },
        governance:
          allowedTiers.trim()
            ? { allowedTiers: allowedTiers.split(",").map((t) => t.trim()).filter(Boolean) }
            : undefined,
        reliability: reliability.trim() ? parseFloat(reliability) : undefined,
        expertise: Object.keys(expertiseObj).length > 0 ? expertiseObj : undefined,
      };
      const res = await fetch("/api/ops/model-hr/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Upsert failed");
      setId("");
      setProvider("");
      setDisplayName("");
      setInPer1k("");
      setOutPer1k("");
      setAllowedTiers("");
      setReliability("");
      setExpertise("");
      onSuccess();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Upsert failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Add / Update Model">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {formError && <div style={opsStyles.error}>{formError}</div>}
        <div style={opsStyles.gridRow}>
          <div>
            <label style={opsStyles.label}>ID *</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. gpt-4o"
              style={opsStyles.input}
            />
          </div>
          <div>
            <label style={opsStyles.label}>Provider *</label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="e.g. openai"
              style={opsStyles.input}
            />
          </div>
          <div>
            <label style={opsStyles.label}>Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
              style={opsStyles.input}
            />
          </div>
        </div>
        <div style={opsStyles.gridRow}>
          <div>
            <label style={opsStyles.label}>Pricing in/1k (USD)</label>
            <input
              type="text"
              value={inPer1k}
              onChange={(e) => setInPer1k(e.target.value)}
              placeholder="0.0025"
              style={opsStyles.input}
            />
          </div>
          <div>
            <label style={opsStyles.label}>Pricing out/1k (USD)</label>
            <input
              type="text"
              value={outPer1k}
              onChange={(e) => setOutPer1k(e.target.value)}
              placeholder="0.01"
              style={opsStyles.input}
            />
          </div>
          <div>
            <label style={opsStyles.label}>Allowed Tiers</label>
            <input
              type="text"
              value={allowedTiers}
              onChange={(e) => setAllowedTiers(e.target.value)}
              placeholder="cheap, standard, premium"
              style={opsStyles.input}
            />
          </div>
          <div>
            <label style={opsStyles.label}>Reliability (0–1)</label>
            <input
              type="text"
              value={reliability}
              onChange={(e) => setReliability(e.target.value)}
              placeholder="0.95"
              style={opsStyles.input}
            />
          </div>
        </div>
        <div>
          <label style={opsStyles.label}>Expertise (optional)</label>
          <input
            type="text"
            value={expertise}
            onChange={(e) => setExpertise(e.target.value)}
            placeholder="code:0.9, writing:0.85, general:0.9"
            style={opsStyles.input}
          />
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Format: key:value, key:value
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ ...opsStyles.btnPrimary, alignSelf: "flex-start", opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "Saving..." : "Add / Update Model"}
        </button>
      </form>
    </Panel>
  );
}
