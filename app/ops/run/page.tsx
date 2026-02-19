// ─── app/ops/run/page.tsx ───────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { opsStyles } from "../styles";
import {
  PLAN_FIXTURES,
  PACKAGE_FIXTURES,
  RUN_PACKAGES_FIXTURES,
  type Fixture,
} from "../fixtures";

const SCENARIO_RUN_FIXTURES: Fixture[] = [
  {
    name: "CSV → JSON Stats CLI (preset)",
    description: "Multi-worker preset: strategy (premium) + 3 workers (cheap) + aggregation + QA",
    payload: {
      presetId: "csv-json-cli-demo",
      projectBudgetUSD: 8,
      tierProfile: "standard",
      concurrency: { worker: 3, qa: 1 },
      async: true,
    },
  },
  {
    name: "CLI CSV full run",
    description: "Plan → Package → Run, standard tier, async",
    payload: {
      directive: "Build a CLI tool that parses CSV files and outputs JSON statistics",
      projectBudgetUSD: 5,
      tierProfile: "standard",
      difficulty: "medium",
      estimateOnly: false,
      includeCouncilAudit: false,
      includeCouncilDebug: false,
      async: true,
      concurrency: { worker: 3, qa: 1 },
    },
  },
  {
    name: "Estimate only",
    description: "Plan + Package only, no execution",
    payload: {
      directive: "Create a hello world script",
      projectBudgetUSD: 1,
      tierProfile: "cheap",
      difficulty: "low",
      estimateOnly: true,
      includeCouncilAudit: false,
      async: false,
    },
  },
  {
    name: "Sync run",
    description: "Full sync execution, returns bundle",
    payload: {
      directive: "Create a hello world script",
      projectBudgetUSD: 1,
      tierProfile: "cheap",
      difficulty: "low",
      estimateOnly: false,
      includeCouncilAudit: false,
      async: false,
      concurrency: { worker: 2, qa: 1 },
    },
  },
];

type TabId = "plan" | "audit" | "packages" | "run" | "ledger";

const EXAMPLE = {
  directive: "Build a CLI tool that parses CSV files and outputs JSON statistics",
  projectBudgetUSD: 5,
  tierProfile: "standard" as const,
  difficulty: "medium" as const,
};

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (value == null) return value;
    if (value instanceof Error) {
      return { message: value.message, name: value.name };
    }
    if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if ("_zod" in value || "issues" in value) {
        const v = value as { message?: string; issues?: unknown };
        const issues = v?.issues;
        const safeDetails = Array.isArray(issues)
          ? issues.map((i: unknown) =>
              typeof i === "object" && i !== null && "message" in i
                ? { path: (i as { path?: unknown }).path, message: (i as { message?: string }).message }
                : i
            )
          : issues;
        return { message: v?.message ?? "Validation error", details: safeDetails };
      }
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
  try {
    return JSON.stringify(obj, replacer, 2);
  } catch {
    return typeof obj === "object" && obj !== null && "message" in obj
      ? JSON.stringify({ message: (obj as { message: unknown }).message })
      : String(obj ?? "");
  }
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre style={{ ...opsStyles.jsonBlock, maxHeight: 384 }}>
      {safeStringify(data)}
    </pre>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active ? opsStyles.tabButtonActive : opsStyles.tabButton}
    >
      {children}
    </button>
  );
}

function CopyButton({ payload }: { payload: unknown }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(safeStringify(payload));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" onClick={handleCopy} style={opsStyles.btnSecondary}>
      {copied ? "Copied!" : "Copy request JSON"}
    </button>
  );
}

const POLL_MAX_MS = 10 * 60 * 1000;
const POLL_INITIAL_MS = 250;
const POLL_MAX_INTERVAL_MS = 2000;

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

type JsonTestMode = "PlanRequest" | "PackageRequest" | "RunPackagesRequest" | "ScenarioRunRequest";

type AssertionId = "successTrue" | "noError" | "noCriticalUnderfundedWarning" | "hasPlanOrPackages" | "cheapestViableChosen";
interface AssertionResult {
  id: AssertionId;
  pass: boolean;
  message: string;
  skipped?: boolean;
}

interface LedgerSummaryWithDecisions {
  costs?: { totalUSD?: number };
  routing?: { portfolioMode?: string; bypassRate?: number };
  governance?: { councilPlanningSkipped?: boolean };
  decisions?: Array<{
    type: string;
    packageId?: string;
    details?: {
      packageId?: string;
      chosenModelId?: string;
      chosenPredictedCostUSD?: number;
      routingCandidates?: Array<{ modelId: string; predictedCostUSD: number; passed: boolean }>;
      pricingMismatchCount?: number;
      pricingMismatches?: Array<{ modelId: string; predictedCostUSD: number; pricingExpectedCostUSD: number; ratio: number }>;
    };
  }>;
}

const EPS = 1e-6;

function runAssertions(
  response: unknown,
  mode: JsonTestMode,
  enabled: Record<AssertionId, boolean>,
  ledgerSummary?: LedgerSummaryWithDecisions | null
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const r = response as Record<string, unknown>;

  if (enabled.successTrue) {
    const pass = r.success === true;
    results.push({
      id: "successTrue",
      pass,
      message: pass ? "response.success === true" : "response.success !== true",
    });
  }
  if (enabled.noError) {
    const pass = r.error == null;
    results.push({
      id: "noError",
      pass,
      message: pass ? "response.error is absent" : "response.error is present",
    });
  }
  if (enabled.noCriticalUnderfundedWarning) {
    const warnings = r.budgetWarnings as string[] | undefined;
    const hasCritical = Array.isArray(warnings) && warnings.some((w) => String(w).includes("critical_underfunded:"));
    const pass = !hasCritical;
    results.push({
      id: "noCriticalUnderfundedWarning",
      pass,
      message: pass ? "no critical_underfunded in budgetWarnings" : "budgetWarnings contains critical_underfunded:",
    });
  }
  if (enabled.hasPlanOrPackages) {
    let pass = false;
    if (mode === "PlanRequest") pass = r.plan != null;
    else if (mode === "PackageRequest") pass = Array.isArray(r.packages);
    else if (mode === "RunPackagesRequest") pass = r.result != null;
    else if (mode === "ScenarioRunRequest") pass = r.plan != null;
    results.push({
      id: "hasPlanOrPackages",
      pass,
      message: pass
        ? `expected field (plan/packages/result) exists`
        : `expected field (plan/packages/result) missing for ${mode}`,
    });
  }
  if (enabled.cheapestViableChosen && (mode === "RunPackagesRequest" || mode === "PackageRequest" || mode === "ScenarioRunRequest")) {
    const routeDecisions = ledgerSummary?.decisions?.filter((d) => d.type === "ROUTE") ?? [];
    const withCandidates = routeDecisions.filter(
      (d) => Array.isArray(d.details?.routingCandidates) && d.details.routingCandidates.length > 0
    );
    if (withCandidates.length === 0) {
      results.push({
        id: "cheapestViableChosen",
        pass: true,
        message: "Skipped: no ROUTE decisions with candidates in ledger",
        skipped: true,
      });
    } else {
      let allPass = true;
      const messages: string[] = [];
      for (const dec of withCandidates) {
        const candidates = dec.details!.routingCandidates!;
        const chosenModelId = dec.details!.chosenModelId;
        const chosenPredictedCostUSD = dec.details!.chosenPredictedCostUSD;
        const eligible = candidates.filter((c) => c.passed);
        if (eligible.length === 0) continue;
        const minCost = Math.min(...eligible.map((c) => c.predictedCostUSD));
        const cheapestModels = eligible.filter((c) => Math.abs(c.predictedCostUSD - minCost) <= EPS).map((c) => c.modelId);
        const isCheapest =
          chosenModelId != null &&
          (cheapestModels.includes(chosenModelId) ||
            (chosenPredictedCostUSD != null && Math.abs(chosenPredictedCostUSD - minCost) <= EPS));
        if (!isCheapest) {
          allPass = false;
          messages.push(
            `packageId ${dec.packageId ?? dec.details?.packageId ?? "?"}: chosen ${chosenModelId} ($${chosenPredictedCostUSD?.toFixed(4)}) not among cheapest ($${minCost.toFixed(4)})`
          );
        }
      }
      results.push({
        id: "cheapestViableChosen",
        pass: allPass,
        message: allPass
          ? `All ${withCandidates.length} ROUTE(s) chose cheapest viable model`
          : messages.join("; "),
      });
    }
  }
  return results;
}

export default function OpsRunPage() {
  const [directive, setDirective] = useState(EXAMPLE.directive);
  const [projectBudgetUSD, setProjectBudgetUSD] = useState(EXAMPLE.projectBudgetUSD);
  const [tierProfile, setTierProfile] = useState<"cheap" | "standard" | "premium">(EXAMPLE.tierProfile);
  const [difficulty, setDifficulty] = useState<"low" | "medium" | "high">(EXAMPLE.difficulty);
  const [estimateOnly, setEstimateOnly] = useState(false);
  const [includeCouncilAudit, setIncludeCouncilAudit] = useState(false);
  const [includeCouncilDebug, setIncludeCouncilDebug] = useState(false);
  const [concurrencyWorker, setConcurrencyWorker] = useState(3);
  const [concurrencyQa, setConcurrencyQa] = useState(1);
  const [asyncMode, setAsyncMode] = useState(false);
  const [presetId, setPresetId] = useState<string>("");

  const [plan, setPlan] = useState<unknown>(null);
  const [audit, setAudit] = useState<unknown>(null);
  const [packages, setPackages] = useState<unknown[]>([]);
  const [runResult, setRunResult] = useState<{
    runs?: Array<{ packageId: string; modelId: string; actualCostUSD: number; isEstimatedCost?: boolean; artifactId?: string }>;
    qaResults?: Array<{ packageId: string; workerPackageId: string; pass: boolean; qualityScore: number; modelId: string }>;
    escalations?: unknown[];
    budget?: { startingUSD: number; remainingUSD: number };
    warnings?: string[];
  } | null>(null);
  const [runSessionId, setRunSessionId] = useState<string | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummaryWithDecisions | null>(null);

  const [loading, setLoading] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("plan");
  const [jsonTestMode, setJsonTestMode] = useState<JsonTestMode>("PlanRequest");
  const [jsonTestInput, setJsonTestInput] = useState("");
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<string>("");
  const [jsonTestResponse, setJsonTestResponse] = useState<unknown>(null);
  const [assertionResults, setAssertionResults] = useState<AssertionResult[]>([]);
  const [assertionEnabled, setAssertionEnabled] = useState<Record<AssertionId, boolean>>({
    successTrue: true,
    noError: true,
    noCriticalUnderfundedWarning: true,
    hasPlanOrPackages: true,
    cheapestViableChosen: true,
  });

  const planPayload = {
    directive,
    projectBudgetUSD,
    tierProfile,
    difficulty,
    estimateOnly,
    includeCouncilDebug,
  };

  const packagePayload = plan && typeof plan === "object" && "plan" in plan
    ? {
        plan: (plan as { plan: unknown }).plan,
        directive,
        includeCouncilAudit,
        tierProfile,
        projectBudgetUSD,
      }
    : null;

  const runPayload = packages.length > 0
    ? {
        packages,
        projectBudgetUSD,
        tierProfile,
        concurrency: { worker: concurrencyWorker, qa: concurrencyQa },
        cheapestViableChosen: assertionEnabled.cheapestViableChosen,
      }
    : null;

  const scenarioPayload = presetId
    ? { presetId, projectBudgetUSD, tierProfile, concurrency: { worker: concurrencyWorker, qa: concurrencyQa }, async: asyncMode }
    : {
        directive,
        projectBudgetUSD,
        tierProfile,
        difficulty,
        estimateOnly,
        includeCouncilAudit,
        includeCouncilDebug,
        concurrency: { worker: concurrencyWorker, qa: concurrencyQa },
        async: asyncMode,
      };

  function buildLedgerSummaryFromLedger(l: {
    costs?: Record<string, number>;
    decisions?: Array<{ type: string; details?: Record<string, unknown> }>;
  } | null): LedgerSummaryWithDecisions | null {
    if (!l) return null;
    const totalUSD = (l.costs?.councilUSD ?? 0) + (l.costs?.workerUSD ?? 0) + (l.costs?.qaUSD ?? 0) + (l.costs?.deterministicQaUSD ?? 0);
    const routeDecisions = (l.decisions ?? []).filter((d) => d.type === "ROUTE");
    const withPortfolio = routeDecisions.filter((d) => {
      const mode = d.details?.portfolioMode as string | undefined;
      return mode && mode !== "off";
    });
    const bypassed = routeDecisions.filter((d) => d.details?.portfolioBypassed === true);
    return {
      costs: { totalUSD },
      routing: {
        portfolioMode: withPortfolio[0]?.details?.portfolioMode as string | undefined,
        bypassRate: withPortfolio.length > 0 ? bypassed.length / withPortfolio.length : 0,
      },
      governance: {
        councilPlanningSkipped: (l.decisions ?? []).some(
          (d) => d.type === "BUDGET_OPTIMIZATION" && d.details?.councilPlanningSkipped === true
        ),
      },
      decisions: l.decisions ?? [],
    };
  }

  async function fetchLedgerSummary(sid: string): Promise<LedgerSummaryWithDecisions | null> {
    try {
      const res = await fetch(`/api/projects/ledger?id=${sid}`);
      const data = await res.json();
      if (!res.ok || !data.ledger) return null;
      return buildLedgerSummaryFromLedger(data.ledger);
    } catch {
      return null;
    }
  }

  async function fetchLedgerSummaryFromBundle(sid: string): Promise<LedgerSummaryWithDecisions | null> {
    try {
      const res = await fetch(`/api/projects/run-bundle?id=${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!res.ok || !data.bundle?.ledger) return null;
      return buildLedgerSummaryFromLedger(data.bundle.ledger);
    } catch {
      return null;
    }
  }

  const loadLedgerForSession = useCallback(async (sid: string) => {
    const summary = await fetchLedgerSummary(sid);
    if (summary) setLedgerSummary(summary);
  }, []);

  async function handlePlan() {
    setLoading("plan");
    setError(null);
    try {
      const res = await fetch("/api/projects/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(planPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Plan failed");
      setPlan(data);
      setActiveTab("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan failed");
    } finally {
      setLoading(null);
    }
  }

  async function handlePackage() {
    if (!packagePayload) {
      setError("Run Plan first");
      return;
    }
    setLoading("package");
    setError(null);
    try {
      const res = await fetch("/api/projects/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packagePayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Package failed");
      setPackages(data.packages ?? []);
      setAudit(data.audit ?? null);
      setActiveTab("packages");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Package failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleRun() {
    if (!runPayload) {
      setError("Run Package first");
      return;
    }
    setLoading("run");
    setError(null);
    setPollStatus("idle");
    try {
      const url = `/api/projects/run-packages${asyncMode ? "?async=true" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Run failed");

      if (asyncMode && data.runSessionId) {
        setRunSessionId(data.runSessionId);
        setPollStatus("running");
        const sid = data.runSessionId;
        const start = Date.now();
        let interval = POLL_INITIAL_MS;

        const poll = async () => {
          if (Date.now() - start > POLL_MAX_MS) {
            setError("Polling timeout (10 min)");
            setPollStatus("failed");
            setLoading(null);
            return;
          }
          try {
            const sres = await fetch(`/api/projects/run-session?id=${sid}`);
            const sdata = await sres.json();
            const status = sdata.session?.status;

            if (status === "completed") {
              const partial = sdata.session?.progress?.partialResult ?? sdata.session;
              setRunResult(partial);
              setPollStatus("completed");
              setLoading(null);
              setActiveTab("run");
              loadLedgerForSession(sid);
              return;
            }
            if (status === "failed") {
              setError(sdata.session?.progress?.warnings?.[0] ?? "Run failed");
              setPollStatus("failed");
              setLoading(null);
              return;
            }
          } catch {
            /* retry */
          }
          setTimeout(poll, interval);
          interval = Math.min(interval * 1.5, POLL_MAX_INTERVAL_MS);
        };
        setTimeout(poll, interval);
      } else {
        const res = data.result ?? data;
        setRunResult(res);
        setRunSessionId(data.runSessionId ?? null);
        setLedgerSummary(null);
        if (data.runSessionId) loadLedgerForSession(data.runSessionId);
        setPollStatus("completed");
        setLoading(null);
        setActiveTab("run");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
      setPollStatus("failed");
      setLoading(null);
    }
  }

  async function loadLedger() {
    if (!runSessionId) return;
    setLoading("ledger");
    setError(null);
    try {
      const summary = await fetchLedgerSummary(runSessionId);
      if (summary) setLedgerSummary(summary);
      setActiveTab("ledger");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ledger failed");
    } finally {
      setLoading(null);
    }
  }

  function loadExample() {
    setDirective(EXAMPLE.directive);
    setProjectBudgetUSD(EXAMPLE.projectBudgetUSD);
    setTierProfile(EXAMPLE.tierProfile);
    setDifficulty(EXAMPLE.difficulty);
  }

  const fixturesForMode: Fixture[] =
    jsonTestMode === "PlanRequest"
      ? PLAN_FIXTURES
      : jsonTestMode === "PackageRequest"
        ? PACKAGE_FIXTURES
        : jsonTestMode === "ScenarioRunRequest"
          ? SCENARIO_RUN_FIXTURES
          : RUN_PACKAGES_FIXTURES;

  function loadFixture(fixture: Fixture) {
    setJsonTestInput(JSON.stringify(fixture.payload, null, 2));
    setSelectedFixture(fixture.name);
    setJsonParseError(null);
    setJsonTestResponse(null);
    setAssertionResults([]);
  }

  function resetTestJson() {
    setJsonTestInput("");
    setSelectedFixture("");
    setJsonParseError(null);
    setJsonTestResponse(null);
    setAssertionResults([]);
  }

  function applyJsonTest() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const v = result.value as Record<string, unknown>;
    if (jsonTestMode === "PlanRequest") {
      if (typeof v.directive === "string") setDirective(v.directive);
      if (typeof v.projectBudgetUSD === "number") setProjectBudgetUSD(v.projectBudgetUSD);
      if (["low", "medium", "high"].includes(String(v.difficulty))) setDifficulty(v.difficulty as "low" | "medium" | "high");
      if (typeof v.estimateOnly === "boolean") setEstimateOnly(v.estimateOnly);
      if (typeof v.includeCouncilDebug === "boolean") setIncludeCouncilDebug(v.includeCouncilDebug);
      if (["cheap", "standard", "premium"].includes(String(v.tierProfile))) setTierProfile(v.tierProfile as "cheap" | "standard" | "premium");
    } else if (jsonTestMode === "PackageRequest") {
      if (v.plan != null) setPlan(v.plan);
      if (typeof v.directive === "string") setDirective(v.directive);
      if (typeof v.includeCouncilAudit === "boolean") setIncludeCouncilAudit(v.includeCouncilAudit);
      if (["cheap", "standard", "premium"].includes(String(v.tierProfile))) setTierProfile(v.tierProfile as "cheap" | "standard" | "premium");
      if (typeof v.projectBudgetUSD === "number") setProjectBudgetUSD(v.projectBudgetUSD);
    } else if (jsonTestMode === "RunPackagesRequest") {
      if (Array.isArray(v.packages)) setPackages(v.packages);
      if (typeof v.projectBudgetUSD === "number") setProjectBudgetUSD(v.projectBudgetUSD);
      if (["cheap", "standard", "premium"].includes(String(v.tierProfile))) setTierProfile(v.tierProfile as "cheap" | "standard" | "premium");
      const c = v.concurrency as { worker?: number; qa?: number } | undefined;
      if (c && typeof c.worker === "number") setConcurrencyWorker(c.worker);
      if (c && typeof c.qa === "number") setConcurrencyQa(c.qa);
    } else if (jsonTestMode === "ScenarioRunRequest") {
      if (typeof v.presetId === "string") setPresetId(v.presetId);
      else setPresetId("");
      if (typeof v.directive === "string") setDirective(v.directive);
      if (typeof v.projectBudgetUSD === "number") setProjectBudgetUSD(v.projectBudgetUSD);
      if (["cheap", "standard", "premium"].includes(String(v.tierProfile))) setTierProfile(v.tierProfile as "cheap" | "standard" | "premium");
      if (["low", "medium", "high"].includes(String(v.difficulty))) setDifficulty(v.difficulty as "low" | "medium" | "high");
      if (typeof v.estimateOnly === "boolean") setEstimateOnly(v.estimateOnly);
      if (typeof v.includeCouncilAudit === "boolean") setIncludeCouncilAudit(v.includeCouncilAudit);
      if (typeof v.includeCouncilDebug === "boolean") setIncludeCouncilDebug(v.includeCouncilDebug);
      if (typeof v.async === "boolean") setAsyncMode(v.async);
      const c = v.concurrency as { worker?: number; qa?: number } | undefined;
      if (c && typeof c.worker === "number") setConcurrencyWorker(c.worker);
      if (c && typeof c.qa === "number") setConcurrencyQa(c.qa);
    }
  }

  function runAssertionsAndStore(response: unknown, ledger?: LedgerSummaryWithDecisions | null) {
    setJsonTestResponse(response);
    const results = runAssertions(response, jsonTestMode, assertionEnabled, ledger);
    setAssertionResults(results);
  }

  async function runWithJsonTest() {
    const result = parseJsonSafe(jsonTestInput);
    setJsonParseError(null);
    if (!result.ok) {
      setJsonParseError(result.error);
      return;
    }
    const body = result.value;
    setError(null);
    setJsonTestResponse(null);
    setAssertionResults([]);
    if (jsonTestMode === "PlanRequest") {
      setLoading("plan");
      try {
        const res = await fetch("/api/projects/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        runAssertionsAndStore(data);
        if (!res.ok) throw new Error(data?.error?.message ?? "Plan failed");
        setPlan(data);
        setActiveTab("plan");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Plan failed");
      } finally {
        setLoading(null);
      }
    } else if (jsonTestMode === "PackageRequest") {
      setLoading("package");
      try {
        const res = await fetch("/api/projects/package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        runAssertionsAndStore(data);
        if (!res.ok) throw new Error(data?.error?.message ?? "Package failed");
        setPackages(data.packages ?? []);
        setAudit(data.audit ?? null);
        setActiveTab("packages");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Package failed");
      } finally {
        setLoading(null);
      }
    } else if (jsonTestMode === "RunPackagesRequest") {
      setLoading("run");
      setPollStatus("idle");
      try {
        const url = `/api/projects/run-packages${asyncMode ? "?async=true" : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (asyncMode && data.runSessionId) {
          runAssertionsAndStore(data);
          if (!res.ok) throw new Error(data?.error?.message ?? "Run failed");
          setRunSessionId(data.runSessionId);
          setPollStatus("running");
          const sid = data.runSessionId;
          const start = Date.now();
          let interval = POLL_INITIAL_MS;
          const poll = async () => {
            if (Date.now() - start > POLL_MAX_MS) {
              setError("Polling timeout (10 min)");
              setPollStatus("failed");
              setLoading(null);
              return;
            }
            try {
              const sres = await fetch(`/api/projects/run-session?id=${sid}`);
              const sdata = await sres.json();
              const status = sdata.session?.status;
              if (status === "completed") {
                const partial = sdata.session?.progress?.partialResult ?? sdata.session;
                const ledgerSummary = await fetchLedgerSummary(sid);
                setLedgerSummary(ledgerSummary);
                runAssertionsAndStore({ success: true, result: partial }, ledgerSummary);
                setRunResult(partial);
                setPollStatus("completed");
                setLoading(null);
                setActiveTab("run");
                return;
              }
              if (status === "failed") {
                runAssertionsAndStore({ success: false, error: { message: sdata.session?.progress?.warnings?.[0] ?? "Run failed" } });
                setError(sdata.session?.progress?.warnings?.[0] ?? "Run failed");
                setPollStatus("failed");
                setLoading(null);
                return;
              }
            } catch { /* retry */ }
            setTimeout(poll, interval);
            interval = Math.min(interval * 1.5, POLL_MAX_INTERVAL_MS);
          };
          setTimeout(poll, interval);
        } else {
          const resData = data.result ?? data;
          const ledgerSummary = data.runSessionId ? await fetchLedgerSummary(data.runSessionId) : null;
          setLedgerSummary(ledgerSummary);
          runAssertionsAndStore(data, ledgerSummary);
          if (!res.ok) throw new Error(data?.error?.message ?? "Run failed");
          setRunResult(resData);
          setRunSessionId(data.runSessionId ?? null);
          setPollStatus("completed");
          setLoading(null);
          setActiveTab("run");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Run failed");
        setPollStatus("failed");
        setLoading(null);
      }
    } else if (jsonTestMode === "ScenarioRunRequest") {
      setLoading("run");
      setPollStatus("idle");
      try {
        const res = await fetch("/api/projects/run-scenario", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Scenario failed");

        setPlan(data.plan ?? null);
        setPackages(data.packages ?? []);
        setAudit(data.audit ?? null);

        if (data.estimateOnly) {
          runAssertionsAndStore(data);
          setActiveTab("plan");
          setLoading(null);
          return;
        }

        const sid = data.runSessionId ?? null;
        if (sid) setRunSessionId(sid);

        const needsPoll = data.async || !data.result;
        if (needsPoll && sid) {
          runAssertionsAndStore(data);
          setPollStatus("running");
          const start = Date.now();
          let interval = POLL_INITIAL_MS;
          const poll = async () => {
            if (Date.now() - start > POLL_MAX_MS) {
              setError("Polling timeout (10 min)");
              setPollStatus("failed");
              setLoading(null);
              return;
            }
            try {
              const sres = await fetch(`/api/projects/run-session?id=${sid}`);
              const sdata = await sres.json();
              const status = sdata.session?.status;
              if (status === "completed") {
                const partial = sdata.session?.progress?.partialResult ?? sdata.session;
                const resResult = partial ?? data.result ?? { warning: "No result returned; see ledger/bundle" };
                setRunResult(resResult);
                const ledgerFromBundle = await fetchLedgerSummaryFromBundle(sid);
                setLedgerSummary(ledgerFromBundle);
                const bundleRes = await fetch(`/api/projects/run-bundle?id=${encodeURIComponent(sid)}`);
                const bundleData = await bundleRes.json();
                const responseForAssertions = {
                  success: true,
                  result: resResult,
                  plan: data.plan,
                  packages: data.packages,
                  bundle: bundleData.bundle,
                };
                runAssertionsAndStore(responseForAssertions, ledgerFromBundle);
                setPollStatus("completed");
                setLoading(null);
                setActiveTab("run");
                return;
              }
              if (status === "failed") {
                runAssertionsAndStore({ success: false, error: { message: sdata.session?.progress?.warnings?.[0] ?? "Run failed" } });
                setError(sdata.session?.progress?.warnings?.[0] ?? "Run failed");
                setPollStatus("failed");
                setLoading(null);
                return;
              }
            } catch { /* retry */ }
            setTimeout(poll, interval);
            interval = Math.min(interval * 1.5, POLL_MAX_INTERVAL_MS);
          };
          setTimeout(poll, interval);
        } else {
          const resResult = data.result ?? { warning: "No result returned; see ledger/bundle" };
          setRunResult(resResult);
          let ledgerFromBundle: LedgerSummaryWithDecisions | null = null;
          if (sid) {
            ledgerFromBundle = await fetchLedgerSummaryFromBundle(sid);
          }
          if (!ledgerFromBundle && data.bundle?.ledger) {
            ledgerFromBundle = buildLedgerSummaryFromLedger(data.bundle.ledger);
          }
          setLedgerSummary(ledgerFromBundle);
          runAssertionsAndStore(data, ledgerFromBundle);
          setPollStatus("completed");
          setLoading(null);
          setActiveTab("run");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Scenario failed");
        setPollStatus("failed");
        setLoading(null);
      }
    }
  }

  function getCopyPayloadForMode(): unknown {
    if (jsonTestMode === "PlanRequest") return planPayload;
    if (jsonTestMode === "PackageRequest") return packagePayload;
    if (jsonTestMode === "RunPackagesRequest") return runPayload;
    if (jsonTestMode === "ScenarioRunRequest") return scenarioPayload;
    return null;
  }

  const totalCost =
    runResult?.budget != null
      ? runResult.budget.startingUSD - (runResult.budget.remainingUSD ?? 0)
      : ledgerSummary?.costs?.totalUSD;

  const inputStyle = { ...opsStyles.input, width: 56 };
  return (
    <div style={opsStyles.spaceY}>
      <div>
        <h1 style={opsStyles.pageTitle}>Run</h1>
        <p style={opsStyles.pageSubtitle}>Plan, package, and execute project runs</p>
      </div>

      <section style={opsStyles.section}>
        <div style={opsStyles.sectionHeader}>Configuration</div>
        <div style={opsStyles.sectionBody}>
          <div style={{ marginBottom: 20 }}>
            <label style={opsStyles.label}>Directive</label>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <textarea
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                style={{ ...opsStyles.textarea, flex: 1, minWidth: 0 }}
                rows={3}
              />
              <button type="button" onClick={loadExample} style={opsStyles.btnSecondary}>
                Load example
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 16, marginBottom: 20 }}>
            <div>
              <label style={opsStyles.label}>Budget $</label>
              <input type="number" value={projectBudgetUSD} onChange={(e) => setProjectBudgetUSD(Number(e.target.value))} style={opsStyles.input} />
            </div>
            <div>
              <label style={opsStyles.label}>Tier</label>
              <select value={tierProfile} onChange={(e) => setTierProfile(e.target.value as typeof tierProfile)} style={opsStyles.select}>
                <option value="cheap">cheap</option>
                <option value="standard">standard</option>
                <option value="premium">premium</option>
              </select>
            </div>
            <div>
              <label style={opsStyles.label}>Difficulty</label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)} style={opsStyles.select}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#475569" }}>
                <input type="checkbox" checked={estimateOnly} onChange={(e) => setEstimateOnly(e.target.checked)} />
                estimateOnly
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#475569" }}>
                <input type="checkbox" checked={includeCouncilAudit} onChange={(e) => setIncludeCouncilAudit(e.target.checked)} />
                includeCouncilAudit
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#475569" }}>
                <input type="checkbox" checked={includeCouncilDebug} onChange={(e) => setIncludeCouncilDebug(e.target.checked)} />
                includeCouncilDebug
              </label>
            </div>
          </div>
          <div style={{ paddingTop: 16, borderTop: "1px solid #e2e8f0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <span style={opsStyles.label}>Concurrency</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569" }}>
              Worker <input type="number" value={concurrencyWorker} onChange={(e) => setConcurrencyWorker(Number(e.target.value))} style={inputStyle} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569" }}>
              QA <input type="number" value={concurrencyQa} onChange={(e) => setConcurrencyQa(Number(e.target.value))} style={inputStyle} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#475569" }}>
              <input type="checkbox" checked={asyncMode} onChange={(e) => setAsyncMode(e.target.checked)} />
              async
            </label>
          </div>
          <div style={{ paddingTop: 16, borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handlePlan} disabled={!!loading} style={{ ...opsStyles.btnPrimary, opacity: loading ? 0.5 : 1 }}>
              {loading === "plan" ? "..." : "Plan"}
            </button>
            {planPayload && <CopyButton payload={planPayload} />}
            <button onClick={handlePackage} disabled={!!loading} style={{ ...opsStyles.btnSuccess, opacity: loading ? 0.5 : 1 }}>
              {loading === "package" ? "..." : "Package"}
            </button>
            {packagePayload && <CopyButton payload={packagePayload} />}
            <button onClick={handleRun} disabled={!!loading} style={{ ...opsStyles.btnViolet, opacity: loading ? 0.5 : 1 }}>
              {loading === "run" ? (pollStatus === "running" ? "Polling..." : "...") : "Run"}
            </button>
            {runPayload && <CopyButton payload={runPayload} />}
            {runSessionId && (
              <button onClick={loadLedger} disabled={!!loading} style={{ ...opsStyles.btnSecondary, background: "#455a64", color: "#fff", opacity: loading ? 0.5 : 1 }}>
                {loading === "ledger" ? "..." : "Ledger"}
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div style={opsStyles.error}>
          {error}
        </div>
      )}

      <details style={opsStyles.section}>
        <summary style={opsStyles.detailsSummary}>
          <span>▶</span>
          Test JSON
        </summary>
        <div style={opsStyles.detailsContent}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Mode</label>
              <select
                value={jsonTestMode}
                onChange={(e) => {
                  setJsonTestMode(e.target.value as JsonTestMode);
                  setSelectedFixture("");
                }}
                style={opsStyles.select}
              >
                <option value="PlanRequest">PlanRequest</option>
                <option value="PackageRequest">PackageRequest</option>
                <option value="RunPackagesRequest">RunPackagesRequest</option>
                <option value="ScenarioRunRequest">ScenarioRunRequest</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}>Fixture</label>
              <select
                value={selectedFixture}
                onChange={(e) => {
                  const name = e.target.value;
                  setSelectedFixture(name);
                  const f = fixturesForMode.find((x) => x.name === name);
                  if (f) loadFixture(f);
                }}
                style={opsStyles.select}
              >
                <option value="">— Select —</option>
                {fixturesForMode.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedFixture && (
              <span style={{ fontSize: 12, color: "#64748b", maxWidth: 320 }}>
                {fixturesForMode.find((f) => f.name === selectedFixture)?.description}
              </span>
            )}
          </div>
          <textarea
            value={jsonTestInput}
            onChange={(e) => {
              setJsonTestInput(e.target.value);
              setJsonParseError(null);
            }}
            placeholder={jsonTestMode === "PlanRequest" ? '{"directive":"...","projectBudgetUSD":5,"difficulty":"medium","estimateOnly":false,"includeCouncilDebug":false}' : jsonTestMode === "PackageRequest" ? '{"plan":{...},"directive":"...","includeCouncilAudit":false,"tierProfile":"standard","projectBudgetUSD":5}' : jsonTestMode === "ScenarioRunRequest" ? '{"directive":"...","projectBudgetUSD":5,"tierProfile":"standard","difficulty":"medium","estimateOnly":false,"includeCouncilAudit":false,"async":true,"concurrency":{"worker":3,"qa":1}}' : '{"packages":[...],"projectBudgetUSD":5,"tierProfile":"standard","concurrency":{"worker":3,"qa":1}}'}
            style={{ ...opsStyles.textarea, minHeight: 120 }}
            rows={6}
          />
          {jsonParseError && (
            <div style={{ fontSize: 13, color: "#c62828", marginTop: 8 }}>{jsonParseError}</div>
          )}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Assertions</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px", marginBottom: 12 }}>
              {(["successTrue", "noError", "noCriticalUnderfundedWarning", "hasPlanOrPackages", "cheapestViableChosen"] as AssertionId[]).map(
                (id) => {
                  const label = id === "cheapestViableChosen" ? "Enforce cheapest viable (assertion)" : id;
                  const title = id === "cheapestViableChosen"
                    ? "Forces router to select the cheapest candidate that meets minimum quality gates; used for assertion testing"
                    : undefined;
                  return (
                    <label key={id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "#475569" }} title={title}>
                      <input
                        type="checkbox"
                        checked={assertionEnabled[id]}
                        onChange={(e) => setAssertionEnabled((prev) => ({ ...prev, [id]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  );
                }
              )}
            </div>
            {assertionResults.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    background: assertionResults.every((a) => a.pass) ? "#e8f5e9" : "#ffebee",
                    color: assertionResults.every((a) => a.pass) ? "#2e7d32" : "#c62828",
                  }}
                >
                  {assertionResults.every((a) => a.pass) ? "PASS" : "FAIL"}
                </span>
                {assertionResults.filter((a) => !a.pass).length > 0 && (
                  <ul style={{ margin: "8px 0 0 0", paddingLeft: 20, fontSize: 12, color: "#c62828" }}>
                    {assertionResults.filter((a) => !a.pass && !a.skipped).map((a) => (
                      <li key={a.id}>{a.message}</li>
                    ))}
                {assertionResults.filter((a) => a.skipped).map((a) => (
                      <li key={a.id} style={{ color: "#64748b" }}>{a.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={applyJsonTest} style={opsStyles.btnSecondary}>
              Apply JSON
            </button>
            <button onClick={runWithJsonTest} disabled={!!loading} style={{ ...opsStyles.btnViolet, opacity: loading ? 0.5 : 1 }}>
              Run with JSON
            </button>
            <button onClick={resetTestJson} style={opsStyles.btnSecondary}>
              Reset
            </button>
            {(() => {
              const p = getCopyPayloadForMode();
              return p != null ? <CopyButton payload={p} /> : null;
            })()}
          </div>
        </div>
      </details>

      {runResult && (totalCost != null || runResult.escalations?.length || ledgerSummary) && (
        <section style={opsStyles.section}>
          {(() => {
            const pricingMismatchTotal = (ledgerSummary?.decisions ?? []).reduce(
              (acc, d) => acc + (d.type === "ROUTE" ? (d.details?.pricingMismatchCount as number ?? 0) : 0),
              0
            );
            return pricingMismatchTotal > 0 ? (
              <div style={{ padding: 16, marginBottom: 16, background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, color: "#92400e" }}>
                <strong>Pricing mismatch warning:</strong> {pricingMismatchTotal} routing candidate(s) have predictedCostUSD diverging from registry pricing by more than 2×. Check ledger ROUTE details for pricingMismatches.
              </div>
            ) : null;
          })()}
          <div style={opsStyles.sectionHeader}>Run Summary</div>
          <div style={{ padding: 24, display: "flex", flexWrap: "wrap", gap: 24, fontSize: 13 }}>
            {totalCost != null && <span style={{ color: "#475569" }}>Total cost: <strong style={{ color: "#1e293b" }}>${totalCost.toFixed(4)}</strong></span>}
            <span style={{ color: "#475569" }}>Escalations: <strong style={{ color: "#1e293b" }}>{runResult.escalations?.length ?? 0}</strong></span>
            {ledgerSummary?.routing?.portfolioMode && <span style={{ color: "#475569" }}>Portfolio: <strong style={{ color: "#1e293b" }}>{ledgerSummary.routing.portfolioMode}</strong></span>}
            {ledgerSummary?.routing?.bypassRate != null && <span style={{ color: "#475569" }}>Bypass rate: <strong style={{ color: "#1e293b" }}>{(ledgerSummary.routing.bypassRate * 100).toFixed(1)}%</strong></span>}
            {ledgerSummary?.governance?.councilPlanningSkipped && <span style={{ color: "#475569" }}>Council skipped: <strong style={{ color: "#1e293b" }}>Yes</strong></span>}
            <span style={{ color: "#475569" }}>Warnings: <strong style={{ color: "#1e293b" }}>{runResult.warnings?.length ?? 0}</strong></span>
          </div>
        </section>
      )}

      <section style={opsStyles.section}>
        <div style={opsStyles.tabBar}>
          <TabButton active={activeTab === "plan"} onClick={() => setActiveTab("plan")}>Plan</TabButton>
          <TabButton active={activeTab === "audit"} onClick={() => setActiveTab("audit")}>Audit</TabButton>
          <TabButton active={activeTab === "packages"} onClick={() => setActiveTab("packages")}>Packages</TabButton>
          <TabButton active={activeTab === "run"} onClick={() => setActiveTab("run")}>Run Result</TabButton>
          <TabButton active={activeTab === "ledger"} onClick={() => setActiveTab("ledger")}>Ledger Summary</TabButton>
        </div>
        <div style={opsStyles.sectionBody}>
          {activeTab === "plan" && (
            <>
              {plan ? <JsonBlock data={plan} /> : <p style={opsStyles.muted}>No plan yet.</p>}
              {planPayload && <div style={{ marginTop: 16 }}><CopyButton payload={planPayload} /></div>}
            </>
          )}
          {activeTab === "audit" && (audit ? <JsonBlock data={audit} /> : <p style={opsStyles.muted}>No audit yet.</p>)}
          {activeTab === "packages" && (
            <>
              {packages.length > 0 ? <JsonBlock data={packages} /> : <p style={opsStyles.muted}>No packages yet.</p>}
              {packagePayload && <div style={{ marginTop: 16 }}><CopyButton payload={packagePayload} /></div>}
            </>
          )}
          {activeTab === "run" && (
            <>
              {runResult ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {runResult.runs && runResult.runs.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 12 }}>Worker Runs</h3>
                      <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                        <table style={opsStyles.table}>
                          <thead>
                            <tr>
                              <th style={opsStyles.th}>packageId</th>
                              <th style={opsStyles.th}>modelId</th>
                              <th style={{ ...opsStyles.th, textAlign: "right" }}>costUSD</th>
                              <th style={opsStyles.th}>est?</th>
                              <th style={opsStyles.th}>artifactId</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runResult.runs.map((r, i) => (
                              <tr key={i}>
                                <td style={opsStyles.td}>{r.packageId}</td>
                                <td style={opsStyles.td}>{r.modelId}</td>
                                <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>${(r.actualCostUSD ?? 0).toFixed(4)}</td>
                                <td style={opsStyles.td}>{r.isEstimatedCost ? "Y" : "—"}</td>
                                <td style={{ ...opsStyles.td, color: "#64748b" }}>{r.artifactId ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {runResult.qaResults && runResult.qaResults.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 12 }}>QA Results</h3>
                      <div style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                        <table style={opsStyles.table}>
                          <thead>
                            <tr>
                              <th style={opsStyles.th}>targetPackageId</th>
                              <th style={opsStyles.th}>pass</th>
                              <th style={{ ...opsStyles.th, textAlign: "right" }}>qualityScore</th>
                              <th style={opsStyles.th}>deterministic</th>
                              <th style={opsStyles.th}>llm</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runResult.qaResults.map((q, i) => (
                              <tr key={i}>
                                <td style={opsStyles.td}>{q.workerPackageId}</td>
                                <td style={opsStyles.td}>{q.pass ? "✓" : "✗"}</td>
                                <td style={{ ...opsStyles.td, textAlign: "right", fontFamily: "monospace" }}>{q.qualityScore.toFixed(2)}</td>
                                <td style={opsStyles.td}>{q.modelId === "deterministic" ? "Y" : "—"}</td>
                                <td style={opsStyles.td}>{q.modelId !== "deterministic" ? "Y" : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {runResult.escalations && runResult.escalations.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 12 }}>Escalations</h3>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                        {runResult.escalations.map((e, i) => (
                          <li key={i} style={{ borderRadius: 6, border: "1px solid #e2e8f0", padding: 12, background: "#fafafa" }}>
                            <pre style={{ fontSize: 12, fontFamily: "monospace", color: "#334155", overflow: "auto", margin: 0 }}>{safeStringify(e)}</pre>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details style={{ borderRadius: 6, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                    <summary style={{ ...opsStyles.detailsSummary, padding: "12px 16px" }}>
                      <span>▶</span>
                      Raw JSON
                    </summary>
                    <div style={{ padding: 16, borderTop: "1px solid #e2e8f0" }}>
                      <JsonBlock data={runResult} />
                    </div>
                  </details>
                </div>
              ) : (
                <p style={opsStyles.muted}>No run result yet.</p>
              )}
            </>
          )}
          {activeTab === "ledger" && (ledgerSummary ? <JsonBlock data={ledgerSummary} /> : <p style={opsStyles.muted}>No ledger. Run and click Ledger.</p>)}
        </div>
      </section>
    </div>
  );
}
