// ─── app/ops/demo/page.tsx ──────────────────────────────────────────────────
// Investor-friendly Demo Mode: scenario runner, flow, summary cards,
// explainability, artifact viewer. Raw JSON behind expandable Developer details.

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { opsStyles } from "../styles";
import { demoStyles } from "./demoStyles";
import { ScenarioRunner } from "./ScenarioRunner";
import { ProgressStepper } from "./ProgressStepper";
import { SummaryCards } from "./SummaryCards";
import { ExplainabilityPanel } from "./ExplainabilityPanel";
import { DeliveryPreview } from "./DeliveryPreview";
import { DeveloperDetails } from "./DeveloperDetails";
import { ModeToggle } from "./ModeToggle";
import { OnePagerExportLink } from "./OnePagerExportLink";
import type {
  DemoPresetId,
  DemoRunState,
  FlowStep,
  RunScenarioRequest,
  RunScenarioResponse,
  RunScenarioSuccessResponse,
  LastDemoRun,
  TierProfile,
} from "./types";
import { LAST_DEMO_RUN_KEY, isRunScenarioError } from "./types";
import { getPresetById, PRESET_PIPELINE_HINTS } from "./presets";

const POLL_MAX_MS = 10 * 60 * 1000;

type DemoRunListItem = { id: string; ts: string; cost?: number; qaPass?: boolean };
const POLL_INITIAL_MS = 500;
const POLL_MAX_INTERVAL_MS = 3000;

function buildLedgerSummary(ledger: {
  costs?: Record<string, number>;
  decisions?: Array<{ type: string; details?: Record<string, unknown> }>;
} | null) {
  if (!ledger) return null;
  const totalUSD =
    (ledger.costs?.councilUSD ?? 0) +
    (ledger.costs?.workerUSD ?? 0) +
    (ledger.costs?.qaUSD ?? 0) +
    (ledger.costs?.deterministicQaUSD ?? 0);
  const routeDecisions = (ledger.decisions ?? []).filter((d) => d.type === "ROUTE");
  return {
    costs: { totalUSD },
    decisions: routeDecisions.map((d) => ({
      type: d.type,
      packageId: d.details?.packageId,
      chosenModelId: d.details?.chosenModelId,
      compBreakdown: d.details?.compBreakdown,
      routingCandidates: d.details?.routingCandidates,
    })),
  };
}

function extractDeliverableOutput(
  runs?: Array<{ packageId?: string; output?: string; artifactId?: string }>
): string | null {
  if (!runs) return null;
  const aggRun = runs.find((r) => r.packageId?.includes("aggregation") || r.packageId === "aggregation-report");
  return (typeof aggRun?.output === "string" ? aggRun.output : null) ?? null;
}

function persistLastRun(request: RunScenarioRequest, response: RunScenarioResponse): void {
  try {
    const payload: LastDemoRun = { timestamp: Date.now(), request, response };
    localStorage.setItem(LAST_DEMO_RUN_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function loadLastRun(): LastDemoRun | null {
  try {
    const raw = localStorage.getItem(LAST_DEMO_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastDemoRun;
    if (parsed?.request && parsed?.response) return parsed;
    return null;
  } catch {
    return null;
  }
}

export default function DemoPage() {
  const [presetId, setPresetId] = useState<DemoPresetId | null>("csv-json-cli-demo");
  const [projectBudgetUSD, setProjectBudgetUSD] = useState(8);
  const [tierProfile, setTierProfile] = useState<TierProfile>("standard");
  const [concurrencyWorker, setConcurrencyWorker] = useState(3);
  const [concurrencyQa, setConcurrencyQa] = useState(1);
  const [asyncMode, setAsyncMode] = useState(true);

  const [state, setState] = useState<DemoRunState>({
    presetId: null,
    status: "idle",
    runSessionId: null,
    plan: null,
    packages: [],
    result: null,
    ledger: null,
    deliverable: undefined,
  });
  const [fullResponse, setFullResponse] = useState<RunScenarioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [hasLastRun, setHasLastRun] = useState(false);
  const [recentRuns, setRecentRuns] = useState<DemoRunListItem[]>([]);
  const [investorMode, setInvestorMode] = useState(true);
  const [techMode, setTechMode] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<number | null>(null);
  const pollCancelRef = useRef(false);

  useEffect(() => {
    setHasLastRun(loadLastRun() != null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ops/demo/runs?limit=20")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.success && Array.isArray(data.runs))
          setRecentRuns(data.runs);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [state.status]); // refetch when a run completes

  const fetchLedgerFromBundle = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/projects/run-bundle?id=${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!res.ok || !data.bundle?.ledger) return null;
      return buildLedgerSummary(data.bundle.ledger);
    } catch {
      return null;
    }
  }, []);

  const fetchBundleWithLedger = useCallback(
    async (sid: string): Promise<{ ledgerSummary: ReturnType<typeof buildLedgerSummary>; rawLedger: unknown } | null> => {
      try {
        const res = await fetch(`/api/projects/run-bundle?id=${encodeURIComponent(sid)}`);
        const data = await res.json();
        if (!res.ok || !data.bundle?.ledger) return null;
        return {
          ledgerSummary: buildLedgerSummary(data.bundle.ledger),
          rawLedger: data.bundle.ledger,
        };
      } catch {
        return null;
      }
    },
    []
  );

  const request: RunScenarioRequest = {
    presetId: presetId ?? undefined,
    projectBudgetUSD,
    tierProfile,
    concurrency: { worker: concurrencyWorker, qa: concurrencyQa },
    async: asyncMode,
  };

  const runScenario = useCallback(async () => {
    if (!presetId) return;
    setError(null);
    const runStart = Date.now();
    setStartTime(runStart);
    setState((s) => ({
      ...s,
      presetId,
      status: "running",
      runSessionId: null,
    }));
    setFullResponse(null);
    setLastPollTime(null);
    pollCancelRef.current = false;

    try {
      const res = await fetch("/api/projects/run-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data: RunScenarioResponse = await res.json();

      if (isRunScenarioError(data)) {
        setError(data.error.message);
        setState((s) => ({ ...s, status: "failed" }));
        return;
      }
      if (!res.ok) {
        setError((data as { error?: { message?: string } }).error?.message ?? "Scenario failed");
        setState((s) => ({ ...s, status: "failed" }));
        return;
      }

      const successData = data as RunScenarioSuccessResponse;
      setFullResponse(data);

      setState((s) => ({
        ...s,
        plan: successData.plan ?? null,
        packages: successData.packages ?? [],
        runSessionId: successData.runSessionId ?? null,
      }));

      if (successData.estimateOnly) {
        setState((s) => ({ ...s, status: "completed" }));
        persistLastRun(request, data);
        setHasLastRun(true);
        return;
      }

      const sid = successData.runSessionId;
      if (!sid) {
        const result = successData.result ?? null;
        const ledger = successData.bundle?.ledger ? buildLedgerSummary(successData.bundle.ledger) : null;
        setState((s) => ({
          ...s,
          status: "completed",
          result,
          ledger,
          deliverable: result ? extractDeliverableOutput(result.runs) ?? undefined : undefined,
        }));
        persistLastRun(request, data);
        setHasLastRun(true);
        return;
      }

      const poll = async () => {
        if (pollCancelRef.current) return;
        if (Date.now() - runStart > POLL_MAX_MS) {
          setError("Polling timeout");
          setState((s) => ({ ...s, status: "failed" }));
          setLastPollTime(null);
          return;
        }
        try {
          setLastPollTime(Date.now());
          const sres = await fetch(`/api/projects/run-session?id=${sid}`);
          const sdata = await sres.json();
          const status = sdata.session?.status;

          if (status === "completed") {
            const partial = sdata.session?.progress?.partialResult ?? sdata.session;
            const bundleData = await fetchBundleWithLedger(sid);
            const ledger = bundleData?.ledgerSummary ?? null;
            const deliverable = extractDeliverableOutput(partial?.runs);
            const mergedResponse: RunScenarioSuccessResponse = {
              ...successData,
              result: partial,
              bundle: bundleData?.rawLedger
                ? { ...successData.bundle, ledger: bundleData.rawLedger }
                : successData.bundle,
            };
            setFullResponse(mergedResponse);
            persistLastRun(request, mergedResponse);
            setHasLastRun(true);
            setLastPollTime(null);
            setState((s) => ({
              ...s,
              status: "completed",
              result: partial,
              ledger,
              deliverable: deliverable ?? undefined,
            }));
            return;
          }
          if (status === "failed") {
            setLastPollTime(null);
            setError(sdata.session?.progress?.warnings?.[0] ?? "Run failed");
            setState((s) => ({ ...s, status: "failed" }));
            return;
          }
        } catch {
          /* retry */
        }
        if (pollCancelRef.current) return;
        setTimeout(poll, Math.min(POLL_INITIAL_MS * 1.5, POLL_MAX_INTERVAL_MS));
      };
      setTimeout(poll, POLL_INITIAL_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scenario failed";
      setError(msg);
      setState((s) => ({ ...s, status: "failed" }));
    }
  }, [presetId, projectBudgetUSD, tierProfile, concurrencyWorker, concurrencyQa, asyncMode, fetchLedgerFromBundle, fetchBundleWithLedger]);

  const loadLastRunHandler = useCallback(async () => {
    const stored = loadLastRun();
    if (!stored) return;
    const req = stored.request;
    const resp = stored.response;
    setPresetId(req.presetId ?? null);
    setProjectBudgetUSD(req.projectBudgetUSD);
    setTierProfile(req.tierProfile);
    setConcurrencyWorker(req.concurrency?.worker ?? 3);
    setConcurrencyQa(req.concurrency?.qa ?? 1);
    setAsyncMode(req.async ?? true);
    setFullResponse(resp);
    setError(null);
    if (!isRunScenarioError(resp)) {
      const s = resp as RunScenarioSuccessResponse;
      let ledger = s.bundle?.ledger ? buildLedgerSummary(s.bundle.ledger) : null;
      if (!ledger && s.runSessionId) {
        ledger = await fetchLedgerFromBundle(s.runSessionId);
      }
      setState({
        presetId: req.presetId ?? null,
        status: "completed",
        runSessionId: s.runSessionId ?? null,
        plan: s.plan ?? null,
        packages: s.packages ?? [],
        result: s.result ?? null,
        ledger,
        deliverable: s.result ? extractDeliverableOutput(s.result.runs) ?? undefined : undefined,
      });
    }
  }, [fetchLedgerFromBundle]);

  const routeDecisions =
    state.ledger?.decisions?.filter((d) => d.type === "ROUTE") ?? [];

  const currentFlowStep: FlowStep | null =
    state.status === "running"
      ? "execute"
      : state.status === "completed"
        ? "delivery"
        : state.result
          ? "delivery"
          : state.packages.length > 0
            ? "route"
            : state.plan
              ? "package"
              : presetId
                ? "plan"
                : null;

  const completedSteps: FlowStep[] = [];
  if (state.plan) completedSteps.push("plan");
  if (state.packages.length > 0) completedSteps.push("package");
  if (routeDecisions.length > 0) completedSteps.push("route");
  if ((state.result?.runs?.length ?? 0) > 0) completedSteps.push("execute");
  if ((state.result?.qaResults?.length ?? 0) > 0) completedSteps.push("qa");
  if (state.ledger) completedSteps.push("ledger");
  if (state.deliverable != null && state.deliverable !== "") completedSteps.push("delivery");

  const durationSeconds = startTime ? Math.round((Date.now() - startTime) / 1000) : undefined;
  const budget = state.result?.budget;
  const totalCost = budget ? budget.startingUSD - (budget.remainingUSD ?? 0) : state.ledger?.costs?.totalUSD;
  const budgetRemaining = budget?.remainingUSD;
  const qaResults = state.result?.qaResults ?? [];
  const qaPass = qaResults.length > 0 ? qaResults.every((q) => q.pass) : null;
  const escalations = state.result?.escalations?.length ?? 0;
  const packageCount = state.packages.length;
  const workerCount = state.result?.runs?.filter((r) => !r.packageId?.includes("qa")).length ?? 0;
  const qaCount = qaResults.length;

  const handleCancelPoll = useCallback(() => {
    pollCancelRef.current = true;
  }, []);

  const pageStyle = {
    ...opsStyles.spaceY,
    ...demoStyles.page,
  };

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={demoStyles.pageTitle}>Demo</h1>
          <p style={demoStyles.pageSubtitle}>
            Run a scenario, see the pipeline flow, metrics, and AI-generated deliverable.
          </p>
        </div>
        <ModeToggle
          investorMode={investorMode}
          techMode={techMode}
          onInvestorModeChange={setInvestorMode}
          onTechModeChange={setTechMode}
          compact={!investorMode}
        />
      </div>

      {error && (
        <div
          style={{
            ...opsStyles.error,
            padding: 20,
            fontSize: 18,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {error}
        </div>
      )}

      <ScenarioRunner
        presetId={presetId}
        projectBudgetUSD={projectBudgetUSD}
        tierProfile={tierProfile}
        concurrencyWorker={concurrencyWorker}
        concurrencyQa={concurrencyQa}
        async={asyncMode}
        onPresetChange={setPresetId}
        onProjectBudgetUSDChange={setProjectBudgetUSD}
        onTierProfileChange={setTierProfile}
        onConcurrencyWorkerChange={setConcurrencyWorker}
        onConcurrencyQaChange={setConcurrencyQa}
        onAsyncChange={setAsyncMode}
        onRun={runScenario}
        onLoadLastRun={loadLastRunHandler}
        loading={state.status === "running"}
        hasLastRun={hasLastRun}
      />

      <ProgressStepper
        currentStep={currentFlowStep}
        completedSteps={completedSteps}
        isRunning={state.status === "running"}
        asyncMode={asyncMode}
        lastPollTime={lastPollTime}
        onCancel={asyncMode ? handleCancelPoll : undefined}
        investorMode={investorMode}
        pipelineHint={presetId ? PRESET_PIPELINE_HINTS[presetId] : undefined}
      />

      {(state.status === "completed" || state.result) ? (
        <section style={demoStyles.section}>
          <h2 style={demoStyles.sectionTitle}>Results</h2>
          <div style={demoStyles.cardGrid}>
            {state.runSessionId && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Run ID</div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "#334155", wordBreak: "break-all" }}>
                  {state.runSessionId}
                </div>
              </div>
            )}
            {totalCost != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Total cost</div>
                <div style={demoStyles.cardValue}>${totalCost.toFixed(4)}</div>
              </div>
            )}
            {budgetRemaining != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Budget remaining</div>
                <div style={demoStyles.cardValue}>${budgetRemaining.toFixed(4)}</div>
              </div>
            )}
            {durationSeconds != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Duration</div>
                <div style={demoStyles.cardValue}>{durationSeconds}s</div>
              </div>
            )}
            {packageCount != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Packages</div>
                <div style={demoStyles.cardValue}>{packageCount}</div>
              </div>
            )}
            {workerCount != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Workers</div>
                <div style={demoStyles.cardValue}>{workerCount}</div>
              </div>
            )}
            {qaCount != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>QA checks</div>
                <div style={demoStyles.cardValue}>{qaCount}</div>
              </div>
            )}
            {qaPass !== null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>QA result</div>
                <div style={{ ...demoStyles.cardValue, color: qaPass ? "#15803d" : "#b91c1c", fontSize: 18 }}>
                  {qaPass ? "Pass" : "Fail"}
                </div>
              </div>
            )}
            {escalations != null && (
              <div style={demoStyles.card}>
                <div style={demoStyles.cardLabel}>Escalations</div>
                <div style={demoStyles.cardValue}>{escalations}</div>
              </div>
            )}
          </div>
          {state.runSessionId && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
              <Link
                href={`/ops/demo/runs/${state.runSessionId}`}
                style={{
                  ...demoStyles.btnPrimary,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                View full run
              </Link>
              <OnePagerExportLink runSessionId={state.runSessionId} />
            </div>
          )}
        </section>
      ) : (
        <SummaryCards
          cost={totalCost}
          durationSeconds={durationSeconds}
          packageCount={packageCount}
          workerCount={workerCount}
          qaCount={qaCount}
          escalations={escalations}
        />
      )}

      <ExplainabilityPanel routeDecisions={routeDecisions} showCandidateTables={techMode} />

      <DeliveryPreview
        deliverableOutput={typeof state.deliverable === "string" ? state.deliverable : null}
        mode="compact"
        title="Final deliverable"
        directive={getPresetById(presetId)?.directive}
      />

      {recentRuns.length > 0 && (
        <section style={demoStyles.section}>
          <h2 style={demoStyles.sectionTitle}>Recent runs</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {recentRuns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/ops/demo/runs/${r.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "#f8fafc",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    textDecoration: "none",
                    color: "#1e293b",
                    fontSize: 14,
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: "#475569" }}>{r.id}</span>
                  <span style={{ color: "#64748b", fontSize: 13 }}>{r.ts || "—"}</span>
                  {r.cost != null && (
                    <span style={{ fontWeight: 600 }}>${r.cost.toFixed(4)}</span>
                  )}
                  {r.qaPass != null && (
                    <span style={{ color: r.qaPass ? "#15803d" : "#b91c1c", fontWeight: 500 }}>
                      {r.qaPass ? "Pass" : "Fail"}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {techMode && <DeveloperDetails data={fullResponse ?? { state, request }} />}
    </div>
  );
}
