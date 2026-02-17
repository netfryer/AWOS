// ─── app/ops/model-hr/actions/page.tsx ─────────────────────────────────────
// HR Actions Queue: pending actions requiring approval

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { opsStyles } from "../../styles";

interface HrAction {
  id: string;
  tsISO: string;
  modelId: string;
  action: string;
  reason: string;
  recommendedBy: string;
  approved: boolean;
  approvedBy?: string;
  approvedAtISO?: string;
  rejectedBy?: string;
  rejectedAtISO?: string;
  rejectionReason?: string;
}

export default function OpsModelHrActionsPage() {
  const [actions, setActions] = useState<HrAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, "approve" | "reject" | null>>({});
  const [approveBy, setApproveBy] = useState("");
  const [rejectBy, setRejectBy] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/model-hr/actions?limit=100");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Fetch failed");
      setActions(data.actions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  async function handleApprove(id: string) {
    const by = approveBy.trim() || "ops-ui";
    setActionLoading((l) => ({ ...l, [id]: "approve" }));
    try {
      const res = await fetch(`/api/ops/model-hr/actions/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: by }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Approve failed");
      await fetchActions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setActionLoading((l) => ({ ...l, [id]: null }));
    }
  }

  async function handleReject(id: string) {
    const by = rejectBy.trim() || "ops-ui";
    setActionLoading((l) => ({ ...l, [id]: "reject" }));
    try {
      const res = await fetch(`/api/ops/model-hr/actions/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectedBy: by, reason: rejectReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Reject failed");
      await fetchActions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setActionLoading((l) => ({ ...l, [id]: null }));
    }
  }

  const pending = actions.filter((a) => !a.approved && !a.rejectedBy);
  const resolved = actions.filter((a) => a.approved || a.rejectedBy);

  return (
    <div style={opsStyles.spaceY}>
      <div>
        <Link href="/ops/model-hr" style={opsStyles.link}>← Model HR</Link>
        <h1 style={{ ...opsStyles.pageTitle, marginTop: 8 }}>HR Actions Queue</h1>
        <p style={opsStyles.pageSubtitle}>
          Pending actions requiring approval. Approve to apply status changes.
        </p>
      </div>

      {error && <div style={opsStyles.error}>{error}</div>}

      <div style={opsStyles.flexRow}>
        <label style={opsStyles.label}>Approve as (default: ops-ui)</label>
        <input
          type="text"
          value={approveBy}
          onChange={(e) => setApproveBy(e.target.value)}
          placeholder="ops-ui"
          style={{ ...opsStyles.input, width: 140 }}
        />
        <label style={{ ...opsStyles.label, marginLeft: 16 }}>Reject as</label>
        <input
          type="text"
          value={rejectBy}
          onChange={(e) => setRejectBy(e.target.value)}
          placeholder="ops-ui"
          style={{ ...opsStyles.input, width: 140 }}
        />
        <label style={{ ...opsStyles.label, marginLeft: 16 }}>Reject reason (optional)</label>
        <input
          type="text"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="e.g. Manual override"
          style={{ ...opsStyles.input, width: 180 }}
        />
        <button onClick={fetchActions} disabled={loading} style={{ ...opsStyles.btnSecondary, marginLeft: 16 }}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Pending ({pending.length})</div>
        {loading ? (
          <div style={opsStyles.muted}>Loading...</div>
        ) : pending.length === 0 ? (
          <div style={opsStyles.muted}>No pending actions.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={opsStyles.table}>
              <thead>
                <tr>
                  <th style={opsStyles.th}>tsISO</th>
                  <th style={opsStyles.th}>modelId</th>
                  <th style={opsStyles.th}>action</th>
                  <th style={opsStyles.th}>reason</th>
                  <th style={opsStyles.th}>recommendedBy</th>
                  <th style={opsStyles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((a) => (
                  <tr key={a.id}>
                    <td style={opsStyles.td}>{a.tsISO}</td>
                    <td style={opsStyles.td}>{a.modelId}</td>
                    <td style={opsStyles.td}>{a.action}</td>
                    <td style={opsStyles.td}>{a.reason}</td>
                    <td style={opsStyles.td}>{a.recommendedBy}</td>
                    <td style={opsStyles.td}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleApprove(a.id)}
                          disabled={actionLoading[a.id] != null}
                          style={{ ...opsStyles.btnPrimary, fontSize: 12, padding: "4px 8px" }}
                        >
                          {actionLoading[a.id] === "approve" ? "..." : "Approve"}
                        </button>
                        <button
                          onClick={() => handleReject(a.id)}
                          disabled={actionLoading[a.id] != null}
                          style={{ ...opsStyles.btnSecondary, fontSize: 12, padding: "4px 8px" }}
                        >
                          {actionLoading[a.id] === "reject" ? "..." : "Reject"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Resolved ({resolved.length})</div>
        {resolved.length === 0 ? (
          <div style={opsStyles.muted}>No resolved actions.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={opsStyles.table}>
              <thead>
                <tr>
                  <th style={opsStyles.th}>tsISO</th>
                  <th style={opsStyles.th}>modelId</th>
                  <th style={opsStyles.th}>action</th>
                  <th style={opsStyles.th}>reason</th>
                  <th style={opsStyles.th}>recommendedBy</th>
                  <th style={opsStyles.th}>Status</th>
                  <th style={opsStyles.th}>By</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 50).map((a) => (
                  <tr key={a.id}>
                    <td style={opsStyles.td}>{a.tsISO}</td>
                    <td style={opsStyles.td}>{a.modelId}</td>
                    <td style={opsStyles.td}>{a.action}</td>
                    <td style={opsStyles.td}>{a.reason}</td>
                    <td style={opsStyles.td}>{a.recommendedBy}</td>
                    <td style={opsStyles.td}>{a.approved ? "Approved" : "Rejected"}</td>
                    <td style={opsStyles.td}>
                      {a.approved ? a.approvedBy : a.rejectedBy}
                      {a.rejectionReason && `: ${a.rejectionReason}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resolved.length > 50 && (
              <div style={{ ...opsStyles.muted, marginTop: 8 }}>Showing 50 of {resolved.length}</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
