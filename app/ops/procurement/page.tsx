"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";

interface ProviderStatus {
  providerId: string;
  enabled: boolean;
  credentialStatus: "connected" | "missing";
  missingEnvVars?: string[];
}

interface TenantProcurementConfig {
  tenantId: string;
  providerSubscriptions: Array<{ providerId: string; enabled: boolean }>;
  modelAvailability: {
    allowedProviders?: string[];
    blockedProviders?: string[];
    allowedModelIds?: string[];
    blockedModelIds?: string[];
  };
  ignoredRecommendationModelIds?: string[];
}

interface ModelRegistryEntry {
  id: string;
  identity: { provider: string; modelId: string; status: string };
  displayName?: string;
  pricing: { inPer1k: number; outPer1k: number };
}

interface ProcurementRecommendation {
  modelId: string;
  canonicalId: string;
  provider: string;
  reason: string;
  evidence?: Record<string, unknown>;
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

const TENANT_ID = "default";

export default function OpsProcurementPage() {
  const [config, setConfig] = useState<TenantProcurementConfig | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [recommendations, setRecommendations] = useState<{
    providerRecommendations: Array<{ providerId: string; reason: string }>;
    modelRecommendations: ProcurementRecommendation[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/procurement/tenants/${TENANT_ID}`);
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config);
      } else {
        setConfig({
          tenantId: TENANT_ID,
          providerSubscriptions: [],
          modelAvailability: {},
        });
      }
    } catch {
      setConfig({
        tenantId: TENANT_ID,
        providerSubscriptions: [],
        modelAvailability: {},
      });
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/procurement/status?tenant=${TENANT_ID}`);
      const data = await res.json();
      if (data.success) setProviderStatus(data.providers ?? []);
      else setProviderStatus([]);
    } catch {
      setProviderStatus([]);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/model-hr/registry");
      const data = await res.json();
      setModels(data.models ?? []);
    } catch {
      setModels([]);
    }
  }, []);

  const fetchRecommendations = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/procurement/recommendations?tenant=${TENANT_ID}`);
      const data = await res.json();
      if (data.success) {
        setRecommendations({
          providerRecommendations: data.providerRecommendations ?? [],
          modelRecommendations: data.modelRecommendations ?? [],
        });
      } else {
        setRecommendations(null);
      }
    } catch {
      setRecommendations(null);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchConfig(), fetchStatus(), fetchModels(), fetchRecommendations()]).finally(
      () => setLoading(false)
    );
  }, [fetchConfig, fetchStatus, fetchModels, fetchRecommendations]);

  const saveConfig = useCallback(
    async (updates: Partial<TenantProcurementConfig>) => {
      const next = {
        tenantId: TENANT_ID,
        providerSubscriptions: config?.providerSubscriptions ?? [],
        modelAvailability: config?.modelAvailability ?? {},
        ...updates,
      };
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/ops/procurement/tenants/${TENANT_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Save failed");
        setConfig(next);
        await fetchStatus();
        await fetchRecommendations();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [config, fetchStatus, fetchRecommendations]
  );

  const toggleProvider = useCallback(
    (providerId: string, enabled: boolean) => {
      const subs = new Map(
        (config?.providerSubscriptions ?? []).map((s) => [s.providerId, s.enabled])
      );
      for (const p of providerStatus) {
        if (!subs.has(p.providerId)) subs.set(p.providerId, true);
      }
      subs.set(providerId, enabled);
      saveConfig({
        providerSubscriptions: [...subs.entries()].map(([pid, en]) => ({
          providerId: pid,
          enabled: en,
        })),
      });
    },
    [config, providerStatus, saveConfig]
  );

  const addToAllowlist = useCallback(
    (canonicalId: string) => {
      const allowed = config?.modelAvailability?.allowedModelIds ?? [];
      if (allowed.includes(canonicalId)) return;
      saveConfig({
        modelAvailability: {
          ...config?.modelAvailability,
          allowedModelIds: [...allowed, canonicalId],
        },
      });
    },
    [config, saveConfig]
  );

  const ignoreRecommendation = useCallback(
    (canonicalId: string) => {
      const ignored = config?.ignoredRecommendationModelIds ?? [];
      if (ignored.includes(canonicalId)) return;
      saveConfig({
        ignoredRecommendationModelIds: [...ignored, canonicalId],
      });
    },
    [config, saveConfig]
  );

  const modelsByProvider = models.reduce(
    (acc, m) => {
      const p = m.identity.provider;
      if (!acc[p]) acc[p] = [];
      acc[p].push(m);
      return acc;
    },
    {} as Record<string, ModelRegistryEntry[]>
  );

  if (loading) {
    return (
      <div style={opsStyles.mainInner}>
        <h2 style={opsStyles.pageTitle}>Procurement</h2>
        <p style={opsStyles.muted}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={opsStyles.mainInner}>
      <h2 style={opsStyles.pageTitle}>Procurement</h2>
      <p style={opsStyles.pageSubtitle}>
        Manage provider subscriptions, credentials status, and model allowlists.{" "}
        <Link href="/ops/model-hr" style={opsStyles.link}>
          Model HR
        </Link>{" "}
        remains the canonical metadata source.
      </p>

      {error && (
        <div style={opsStyles.error}>
          {error}
        </div>
      )}

      <Panel title="Provider status">
        <p style={{ ...opsStyles.muted, marginBottom: 16 }}>
          Credentials are read from environment variables (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY).
          Never stored on disk.
        </p>
        <table style={opsStyles.table}>
          <thead>
            <tr>
              <th style={opsStyles.th}>Provider</th>
              <th style={opsStyles.th}>Enabled</th>
              <th style={opsStyles.th}>Credentials</th>
              <th style={opsStyles.th}>Models</th>
            </tr>
          </thead>
          <tbody>
            {providerStatus.map((p) => (
              <tr key={p.providerId}>
                <td style={opsStyles.td}>{p.providerId}</td>
                <td style={opsStyles.td}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => toggleProvider(p.providerId, e.target.checked)}
                      disabled={saving}
                    />
                    {p.enabled ? "Yes" : "No"}
                  </label>
                </td>
                <td style={opsStyles.td}>
                  <span
                    style={{
                      color: p.credentialStatus === "connected" ? "#2e7d32" : "#c62828",
                      fontWeight: 500,
                    }}
                  >
                    {p.credentialStatus === "connected" ? "Connected" : "Missing"}
                  </span>
                  {p.missingEnvVars?.length ? (
                    <span style={{ ...opsStyles.muted, marginLeft: 8, fontSize: 12 }}>
                      ({p.missingEnvVars.join(", ")})
                    </span>
                  ) : null}
                </td>
                <td style={opsStyles.td}>
                  {(modelsByProvider[p.providerId] ?? []).length} models
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Model allowlist / denylist">
        <p style={{ ...opsStyles.muted, marginBottom: 16 }}>
          Use canonical ids: <code>provider/modelId</code>. If allowlist is non-empty, only listed
          models are eligible. Blocked models are always excluded.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={opsStyles.label}>Allowed model IDs (one per line)</label>
            <textarea
              style={{ ...opsStyles.textarea, minHeight: 100 }}
              value={(config?.modelAvailability?.allowedModelIds ?? []).join("\n")}
              onChange={(e) =>
                saveConfig({
                  modelAvailability: {
                    ...config?.modelAvailability,
                    allowedModelIds: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="e.g. openai/gpt-4o&#10;anthropic/claude-sonnet-4-5-20250929"
              disabled={saving}
            />
          </div>
          <div>
            <label style={opsStyles.label}>Blocked model IDs (one per line)</label>
            <textarea
              style={{ ...opsStyles.textarea, minHeight: 80 }}
              value={(config?.modelAvailability?.blockedModelIds ?? []).join("\n")}
              onChange={(e) =>
                saveConfig({
                  modelAvailability: {
                    ...config?.modelAvailability,
                    blockedModelIds: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="e.g. openai/gpt-3.5-turbo"
              disabled={saving}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Recommendations">
        <p style={{ ...opsStyles.muted, marginBottom: 16 }}>
          Suggestions from recruiting report, canary results, and registry.
        </p>
        {recommendations?.providerRecommendations?.length ? (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Enable provider</h4>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {recommendations.providerRecommendations.map((r) => (
                <li key={r.providerId} style={{ marginBottom: 4 }}>
                  {r.providerId}: {r.reason}{" "}
                  <button
                    type="button"
                    style={opsStyles.btnPrimary}
                    onClick={() => toggleProvider(r.providerId, true)}
                    disabled={saving}
                  >
                    Enable
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {recommendations?.modelRecommendations?.length ? (
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add model</h4>
            <table style={opsStyles.table}>
              <thead>
                <tr>
                  <th style={opsStyles.th}>Model</th>
                  <th style={opsStyles.th}>Reason</th>
                  <th style={opsStyles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.modelRecommendations.map((r) => (
                  <tr key={r.canonicalId}>
                    <td style={opsStyles.td}>{r.canonicalId}</td>
                    <td style={opsStyles.td}>{r.reason}</td>
                    <td style={opsStyles.td}>
                      <div style={opsStyles.flexGap}>
                        <button
                          type="button"
                          style={opsStyles.btnPrimary}
                          onClick={() => addToAllowlist(r.canonicalId)}
                          disabled={saving}
                        >
                          Add to allowlist
                        </button>
                        <button
                          type="button"
                          style={opsStyles.btnSecondary}
                          onClick={() => ignoreRecommendation(r.canonicalId)}
                          disabled={saving}
                        >
                          Ignore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={opsStyles.muted}>No model recommendations.</p>
        )}
      </Panel>
    </div>
  );
}
