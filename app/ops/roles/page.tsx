// ─── app/ops/roles/page.tsx ──────────────────────────────────────────────────
// Role Analytics Dashboard: CEO/Manager/Worker/QA behavior over time

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";

type RoleKey = "ceo" | "manager" | "worker" | "qa" | string;

interface RoleStats {
  executions: number;
  okRate: number;
  failRate: number;
  avgScore?: number;
  avgCostUSD?: number;
  topModels?: Array<{ modelId: string; executions: number; avgScore?: number; avgCostUSD?: number }>;
  failureNotesTop?: Array<{ note: string; count: number }>;
}

interface RolesResponse {
  totals: { runsScanned: number; roleExecutions: number };
  byRole: Record<RoleKey, RoleStats>;
}

const HOURS_OPTIONS = [
  { value: 0, label: "All" },
  { value: 24, label: "24h" },
  { value: 72, label: "72h" },
  { value: 168, label: "7d" },
];

const ROLE_ORDER: RoleKey[] = ["ceo", "manager", "worker", "qa"];

function RoleCard({
  role,
  stats,
}: {
  role: RoleKey;
  stats: RoleStats;
}) {
  return (
    <div style={opsStyles.card}>
      <div style={{ ...opsStyles.label, textTransform: "capitalize" }}>{role}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: "#1e293b" }}>{stats.executions}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
        ok {(stats.okRate * 100).toFixed(1)}% · fail {(stats.failRate * 100).toFixed(1)}%
      </div>
      {typeof stats.avgScore === "number" && (
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
          avg score: {stats.avgScore.toFixed(2)}
        </div>
      )}
      {typeof stats.avgCostUSD === "number" && stats.avgCostUSD > 0 && (
        <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
          avg cost: ${stats.avgCostUSD.toFixed(4)}
        </div>
      )}
      {stats.topModels && stats.topModels.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {stats.topModels.slice(0, 3).map((m) => (
            <span
              key={m.modelId}
              style={{
                fontSize: 11,
                padding: "4px 8px",
                background: "#f1f5f9",
                borderRadius: 6,
                color: "#475569",
              }}
              title={`${m.executions} execs${m.avgScore != null ? `, score ${m.avgScore.toFixed(2)}` : ""}`}
            >
              {m.modelId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsRolesPage() {
  const [hours, setHours] = useState(168);
  const [data, setData] = useState<RolesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failureTab, setFailureTab] = useState<RoleKey | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/stats/roles?hours=${hours}&limit=5000`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [hours]);

  const rolesWithFailures = data?.byRole
    ? (ROLE_ORDER.filter((r) => (data.byRole[r]?.failureNotesTop?.length ?? 0) > 0) as RoleKey[])
    : [];

  return (
    <div style={opsStyles.spaceY}>
      <div>
        <h1 style={opsStyles.pageTitle}>Role Analytics</h1>
        <p style={opsStyles.pageSubtitle}>
          How each role (CEO/Manager/Worker/QA) behaves over time
        </p>
      </div>

      <section style={opsStyles.section}>
        <div style={{ ...opsStyles.sectionHeader, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span>Time range</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={opsStyles.select}
          >
            {HOURS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div style={opsStyles.sectionBody}>
          {error && <div style={opsStyles.error}>{error}</div>}
          {loading && <p style={opsStyles.muted}>Loading…</p>}
          {!loading && data && (
            <>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                {data.totals.runsScanned} runs scanned · {data.totals.roleExecutions} role executions
              </div>

              <div style={{ ...opsStyles.gridRow, marginBottom: 24 }}>
                {ROLE_ORDER.map((role) => {
                  const stats = data.byRole[role];
                  if (!stats) return null;
                  return <RoleCard key={role} role={role} stats={stats} />;
                })}
              </div>

              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 12 }}>
                  By role
                </h3>
                <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <table style={opsStyles.table}>
                    <thead>
                      <tr>
                        <th style={opsStyles.th}>role</th>
                        <th style={opsStyles.th}>executions</th>
                        <th style={opsStyles.th}>okRate</th>
                        <th style={opsStyles.th}>avgScore</th>
                        <th style={opsStyles.th}>avgCostUSD</th>
                        <th style={opsStyles.th}>topModels</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...ROLE_ORDER.filter((r) => data.byRole[r]),
                        ...Object.keys(data.byRole).filter((r) => !ROLE_ORDER.includes(r)),
                      ].map((role) => {
                        const stats = data.byRole[role];
                        if (!stats) return null;
                        return (
                          <tr key={role}>
                            <td style={opsStyles.td}>{role}</td>
                            <td style={opsStyles.td}>{stats.executions}</td>
                            <td style={opsStyles.td}>{(stats.okRate * 100).toFixed(1)}%</td>
                            <td style={opsStyles.td}>
                              {typeof stats.avgScore === "number"
                                ? stats.avgScore.toFixed(2)
                                : "—"}
                            </td>
                            <td style={opsStyles.td}>
                              {typeof stats.avgCostUSD === "number" && stats.avgCostUSD > 0
                                ? `$${stats.avgCostUSD.toFixed(4)}`
                                : "—"}
                            </td>
                            <td style={opsStyles.td}>
                              {stats.topModels?.slice(0, 2).map((m) => m.modelId).join(", ") ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {rolesWithFailures.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 12 }}>
                    Failure notes
                  </h3>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {rolesWithFailures.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setFailureTab(failureTab === r ? null : r)}
                        style={{
                          ...opsStyles.btnSecondary,
                          ...(failureTab === r ? { background: "#e2e8f0" } : {}),
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {failureTab && data.byRole[failureTab]?.failureNotesTop && (
                    <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                      <table style={opsStyles.table}>
                        <thead>
                          <tr>
                            <th style={opsStyles.th}>note (first 120 chars)</th>
                            <th style={opsStyles.th}>count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.byRole[failureTab].failureNotesTop!.map((n, i) => (
                            <tr key={i}>
                              <td style={{ ...opsStyles.td, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis" }} title={n.note}>
                                {n.note || "(empty)"}
                              </td>
                              <td style={opsStyles.td}>{n.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {!loading && data && data.totals.roleExecutions === 0 && (
                <p style={opsStyles.muted}>
                  No role executions in this window. Run scenarios from{" "}
                  <Link href="/ops/run" style={opsStyles.link}>
                    /ops/run
                  </Link>{" "}
                  to populate.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
