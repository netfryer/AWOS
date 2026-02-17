// ─── app/ops/governance/page.tsx ─────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import { opsStyles } from "../styles";

function parseJsonSafe(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Empty input" };
    const value = JSON.parse(trimmed);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_, v) => (v instanceof Error ? { message: v.message } : v), 2);
  } catch {
    return String(obj ?? "");
  }
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre style={opsStyles.jsonBlock}>
      {safeStringify(data)}
    </pre>
  );
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

export default function OpsGovernancePage() {
  const [portfolioMode, setPortfolioMode] = useState<string | null>(null);
  const [portfolioModeInput, setPortfolioModeInput] = useState("");
  const [portfolioRec, setPortfolioRec] = useState<unknown>(null);
  const [proposals, setProposals] = useState<unknown[]>([]);
  const [trust, setTrust] = useState<unknown>(null);
  const [variance, setVariance] = useState<unknown>(null);

  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [jsonTestMode, setJsonTestMode] = useState<"SetPortfolioMode" | "ApplyTuningProposal" | "SetTuningConfig">("SetPortfolioMode");
  const [jsonTestInput, setJsonTestInput] = useState("");
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [jsonTestResponse, setJsonTestResponse] = useState<unknown>(null);

  async function fetchPortfolioConfig() {
    setLoading((l) => ({ ...l, config: true }));
    setError(null);
    try {
      const res = await fetch("/api/governance/portfolio-config");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setPortfolioMode(data.mode ?? "off");
      setPortfolioModeInput(data.mode ?? "off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading((l) => ({ ...l, config: false }));
    }
  }

  async function setPortfolioConfig() {
    setLoading((l) => ({ ...l, configSet: true }));
    setError(null);
    try {
      const res = await fetch("/api/governance/portfolio-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: portfolioModeInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Set failed");
      setPortfolioMode(data.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Set failed");
    } finally {
      setLoading((l) => ({ ...l, configSet: false }));
    }
  }

  async function fetchPortfolio() {
    setLoading((l) => ({ ...l, portfolio: true }));
    setError(null);
    try {
      const res = await fetch("/api/governance/portfolio");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setPortfolioRec(data.recommendation ?? data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading((l) => ({ ...l, portfolio: false }));
    }
  }

  async function fetchProposals() {
    setLoading((l) => ({ ...l, proposals: true }));
    setError(null);
    try {
      const res = await fetch("/api/observability/tuning/proposals?window=50");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setProposals(data.proposals ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading((l) => ({ ...l, proposals: false }));
    }
  }

  async function applyProposal(proposalId: string) {
    setLoading((l) => ({ ...l, apply: true }));
    setError(null);
    try {
      const res = await fetch("/api/observability/tuning/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Apply failed");
      if (data.applied) {
        await fetchPortfolioConfig();
        await fetchProposals();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setLoading((l) => ({ ...l, apply: false }));
    }
  }

  async function fetchTrust() {
    setLoading((l) => ({ ...l, trust: true }));
    setError(null);
    try {
      const res = await fetch("/api/governance/trust");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setTrust(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading((l) => ({ ...l, trust: false }));
    }
  }

  async function fetchVariance() {
    setLoading((l) => ({ ...l, variance: true }));
    setError(null);
    try {
      const res = await fetch("/api/governance/variance");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setVariance(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading((l) => ({ ...l, variance: false }));
    }
  }

  useEffect(() => {
    fetchPortfolioConfig();
  }, []);

  async function runJsonTest() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    setJsonTestResponse(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const v = result.value as Record<string, unknown>;
    setError(null);
    try {
      if (jsonTestMode === "SetPortfolioMode") {
        const mode = v.mode as string;
        if (!["off", "prefer", "lock"].includes(mode)) {
          setJsonParseError("mode must be off, prefer, or lock");
          return;
        }
        const res = await fetch("/api/governance/portfolio-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const data = await res.json();
        setJsonTestResponse(data);
        if (res.ok) {
          setPortfolioMode(data.mode ?? mode);
          setPortfolioModeInput(data.mode ?? mode);
        }
      } else if (jsonTestMode === "ApplyTuningProposal") {
        const proposalId = v.proposalId as string;
        if (typeof proposalId !== "string") {
          setJsonParseError("proposalId must be a string");
          return;
        }
        const res = await fetch("/api/observability/tuning/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId }),
        });
        const data = await res.json();
        setJsonTestResponse(data);
        if (res.ok && data.applied) {
          await fetchPortfolioConfig();
          await fetchProposals();
        }
      } else if (jsonTestMode === "SetTuningConfig") {
        const body: Record<string, unknown> = {};
        if (typeof v.enabled === "boolean") body.enabled = v.enabled;
        if (typeof v.allowAutoApply === "boolean") body.allowAutoApply = v.allowAutoApply;
        const res = await fetch("/api/observability/tuning/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setJsonTestResponse(data);
      }
    } catch (e) {
      setJsonTestResponse({ error: e instanceof Error ? e.message : "Request failed" });
    }
  }

  return (
    <div style={opsStyles.spaceY}>
      <div>
        <h1 style={opsStyles.pageTitle}>Governance</h1>
        <p style={opsStyles.pageSubtitle}>Portfolio mode, tuning, trust, and variance</p>
      </div>

      {error && <div style={opsStyles.error}>{error}</div>}

      <Panel title="Portfolio Mode">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "#475569" }}>Current: <strong style={{ color: "#1e293b" }}>{portfolioMode ?? "—"}</strong></span>
            <button onClick={fetchPortfolioConfig} disabled={loading.config} style={opsStyles.btnSecondary}>
              Refresh
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={portfolioModeInput}
              onChange={(e) => setPortfolioModeInput(e.target.value)}
              style={opsStyles.select}
            >
              <option value="off">off</option>
              <option value="prefer">prefer</option>
              <option value="lock">lock</option>
            </select>
            <button onClick={setPortfolioConfig} disabled={loading.configSet} style={{ ...opsStyles.btnPrimary, opacity: loading.configSet ? 0.5 : 1 }}>
              Set
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Portfolio Recommendation">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={fetchPortfolio} disabled={loading.portfolio} style={{ ...opsStyles.btnPrimary, opacity: loading.portfolio ? 0.5 : 1 }}>
            {loading.portfolio ? "Loading..." : "Fetch"}
          </button>
          {portfolioRec && <JsonBlock data={portfolioRec} />}
        </div>
      </Panel>

      <Panel title="Tuning">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 13, color: "#475569" }}>
            Enable tuning in server config (tuningConfig.setTuningEnabled) to apply proposals.)
          </p>
          <button onClick={fetchProposals} disabled={loading.proposals} style={{ ...opsStyles.btnPrimary, opacity: loading.proposals ? 0.5 : 1 }}>
            {loading.proposals ? "Loading..." : "Fetch Proposals"}
          </button>
          {proposals.length > 0 && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              {(proposals as Array<{ id: string; action: string; rationale: string; safeToAutoApply: boolean }>).map((p) => (
                <div key={p.id} style={{ borderRadius: 6, border: "1px solid #e2e8f0", padding: 16 }}>
                  <div style={{ fontWeight: 500, color: "#1e293b" }}>{p.action}</div>
                  <div style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>{p.rationale}</div>
                  <div style={{ marginTop: 12 }}>
                    <button
                      onClick={() => applyProposal(p.id)}
                      disabled={loading.apply || !p.safeToAutoApply}
                      style={{
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 6,
                        border: "none",
                        cursor: p.safeToAutoApply && !loading.apply ? "pointer" : "not-allowed",
                        background: p.safeToAutoApply && !loading.apply ? "#2e7d32" : "#94a3b8",
                        color: "#fff",
                        opacity: loading.apply ? 0.5 : 1,
                      }}
                    >
                      {p.safeToAutoApply ? "Apply" : "Not safe"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Trust">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={fetchTrust} disabled={loading.trust} style={{ ...opsStyles.btnPrimary, opacity: loading.trust ? 0.5 : 1 }}>
            {loading.trust ? "Loading..." : "Fetch"}
          </button>
          {trust && <JsonBlock data={trust} />}
        </div>
      </Panel>

      <Panel title="Variance">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={fetchVariance} disabled={loading.variance} style={{ ...opsStyles.btnPrimary, opacity: loading.variance ? 0.5 : 1 }}>
            {loading.variance ? "Loading..." : "Fetch"}
          </button>
          {variance && <JsonBlock data={variance} />}
        </div>
      </Panel>

      <details style={opsStyles.section}>
        <summary style={opsStyles.detailsSummary}>
          <span>▶</span>
          Test JSON
        </summary>
        <div style={opsStyles.detailsContent}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Mode</label>
            <select
              value={jsonTestMode}
              onChange={(e) => setJsonTestMode(e.target.value as typeof jsonTestMode)}
              style={opsStyles.select}
            >
              <option value="SetPortfolioMode">SetPortfolioMode</option>
              <option value="ApplyTuningProposal">ApplyTuningProposal</option>
              <option value="SetTuningConfig">SetTuningConfig</option>
            </select>
          </div>
          <textarea
            value={jsonTestInput}
            onChange={(e) => { setJsonTestInput(e.target.value); setJsonParseError(null); }}
            placeholder={jsonTestMode === "SetPortfolioMode" ? '{"mode":"off|prefer|lock"}' : jsonTestMode === "ApplyTuningProposal" ? '{"proposalId":"..."}' : '{"enabled":true,"allowAutoApply":false}'}
            style={{ ...opsStyles.textarea, minHeight: 100 }}
            rows={4}
          />
          {jsonParseError && <div style={{ fontSize: 13, color: "#c62828", marginTop: 8 }}>{jsonParseError}</div>}
          <button onClick={runJsonTest} style={opsStyles.btnViolet}>
            Run JSON
          </button>
          {jsonTestResponse != null && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 8 }}>Response</div>
              <JsonBlock data={jsonTestResponse} />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
