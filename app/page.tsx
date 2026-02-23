"use client";

import { useState, useRef, useEffect } from "react";

type Profile = "fast" | "strict" | "low_cost";
type TestMode = "none" | "uncertain" | "fail";

interface RunAttempt {
  attempt: number;
  modelId: string;
  prompt: string;
  execution: { status: string; outputText: string };
  validation: { ok: boolean; reasons: string[] };
}

interface RunLogEvent {
  runId: string;
  final: {
    status: string;
    chosenModelId: string | null;
    retryUsed: boolean;
  };
  routing: {
    status: string;
    chosenModelId: string | null;
    fallbackModelIds: string[];
    estimatedTokens: { input: number; output: number };
    expectedCostUSD: number | null;
    rationale: string;
  };
  expectedCostUSD: number | null;
  actualCostUSD?: number;
  attempts: RunAttempt[];
}

interface RequestContext {
  message: string;
  taskType: string;
  difficulty: string;
  profile: Profile;
  constraints?: { minQuality?: number; maxCostUSD?: number };
}

interface ProjectResult {
  runId: string;
  subtasks: {
    subtask: {
      id: string;
      title: string;
      importance: number;
      allocatedBudgetUSD: number;
      recommendedTier?: string;
    };
    result: RunLogEvent;
    forecast?: { selectedModelId: string; estimatedCostUSD: number; predictedQuality: number };
    actual?: { actualCostUSD?: number; actualQuality?: number };
    variance?: {
      costDeltaUSD?: number;
      costDeltaPct?: number;
      qualityDelta?: number;
      qualityDeltaPct?: number;
    };
  }[];
  totalActualCostUSD: number;
  finalOutput: string;
  status: "ok" | "budget_exceeded" | "failed";
}

interface ProjectEstimate {
  status: "ok" | "no_models" | "underfunded";
  totalEstimatedCostUSD: number;
  predictedAverageQuality: number;
  predictedROI: number;
  subtasks: {
    id: string;
    title: string;
    importance: number;
    recommendedTier: string;
    allocatedBudgetUSD: number;
    selectedModelId: string;
    estimatedCostUSD: number;
    predictedQuality: number;
    predictedROI: number;
  }[];
}

interface ExecutiveCouncilResult {
  run: {
    runId: string;
    gate: { status: string; requiredQuestions?: string[]; notes: string[] };
    scoring: { overall: number; completeness: number; consensus: number };
    consensus: { parsed?: { recommendedOptionId?: string; questionsForCEO?: string[]; downstreamBudgetEstimateUSD?: { low: number; likely: number; high: number } } };
    drafts: { modelId: string; text: string; parsed?: unknown }[];
    totalActualCostUSD?: number;
  };
  brief?: { recommendedOptionId?: string; questionsForCEO?: string[]; downstreamBudgetEstimateUSD?: { low: number; likely: number; high: number } };
  gate: { status: string; requiredQuestions?: string[]; notes: string[] };
}

interface Message {
  role: "user" | "assistant";
  content: string;
  result?: RunLogEvent;
  projectResult?: ProjectResult;
  projectEstimate?: ProjectEstimate;
  executiveCouncil?: ExecutiveCouncilResult;
  requestContext?: RequestContext;
}

const OUTPUT_TRUNCATE_LEN = 800;
const STORAGE_KEY = "task-router-chat:v1";

function loadMessages(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNum(val: string | undefined): number | undefined {
  if (val === undefined || val === "") return undefined;
  const n = parseFloat(val);
  return Number.isNaN(n) ? undefined : n;
}

function formatCost(value: number): string {
  if (value < 0.01) return value.toFixed(6);
  return value.toFixed(4);
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [taskType, setTaskType] = useState<"code" | "writing" | "analysis" | "general">("code");
  const [difficulty, setDifficulty] = useState<"low" | "medium" | "high">("low");
  const [profile, setProfile] = useState<Profile>("fast");
  const [testMode, setTestMode] = useState<TestMode>("none");
  const [minQuality, setMinQuality] = useState("");
  const [maxCostUSD, setMaxCostUSD] = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadMessages());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  function handleClearChat() {
    setMessages([]);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: userMessage }]);
    setLoading(true);

    const mq = parseNum(minQuality);
    const mc = parseNum(maxCostUSD);
    const constraints = {
      ...(mq != null ? { minQuality: mq } : {}),
      ...(mc != null ? { maxCostUSD: mc } : {}),
    };

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          taskType,
          difficulty,
          profile,
          testMode,
          ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
        }),
      });

      const result = (await res.json()) as RunLogEvent & { error?: string };

      if (!res.ok) {
        throw new Error(result?.error ?? "Request failed");
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "",
          result,
          requestContext: {
            message: userMessage,
            taskType,
            difficulty,
            profile,
            constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
          },
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendJson() {
    if (!jsonInput.trim() || loading) return;
    setLoading(true);
    try {
      const body = JSON.parse(jsonInput.trim()) as {
        directive: string;
        taskType?: "code" | "writing" | "analysis" | "general";
        difficulty?: "low" | "medium" | "high";
        profile?: "fast" | "strict" | "low_cost";
        constraints?: { minQuality?: number; maxCostUSD?: number };
        testMode?: "none" | "fail" | "uncertain";
        projectBudgetUSD?: number;
        estimateOnly?: boolean;
        governanceOnly?: boolean;
      };
      setMessages((m) => [...m, { role: "user", content: `[JSON] ${body.directive?.slice(0, 50) ?? ""}...` }]);
      setJsonInput("");

      const isGovernance = body.governanceOnly === true;
      const isEstimate =
        !isGovernance &&
        body.estimateOnly === true &&
        body.projectBudgetUSD != null &&
        typeof body.projectBudgetUSD === "number";
      const isProject =
        !isGovernance &&
        !isEstimate &&
        body.projectBudgetUSD != null &&
        typeof body.projectBudgetUSD === "number";

      const url = isGovernance
        ? "/api/governance/clarify"
        : isEstimate
          ? "/api/project/estimate"
          : isProject
            ? "/api/project/run"
            : "/api/test/run";

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = (await res.json()) as
        | (RunLogEvent | ProjectResult | ProjectEstimate | ExecutiveCouncilResult)
        & { error?: string };

      if (!res.ok) {
        throw new Error(result?.error ?? "Request failed");
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "",
          result: !isProject && !isEstimate && !isGovernance ? (result as RunLogEvent) : undefined,
          projectResult: isProject ? (result as ProjectResult) : undefined,
          projectEstimate: isEstimate ? (result as ProjectEstimate) : undefined,
          executiveCouncil: isGovernance ? (result as ExecutiveCouncilResult) : undefined,
          requestContext: {
            message: body.directive ?? "",
            taskType: body.taskType ?? "general",
            difficulty: body.difficulty ?? "medium",
            profile: body.profile ?? "fast",
            constraints: body.constraints,
          },
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Invalid JSON or request failed"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerTop}>
          <h1 style={styles.title}>Task Router</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a href="/ops/run" style={styles.navLink}>Ops Console</a>
            <button type="button" onClick={handleClearChat} style={styles.clearBtn}>
              Clear chat
            </button>
          </div>
        </div>
        <div style={styles.controls}>
          <label>
            Profile:{" "}
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as Profile)}
              style={styles.select}
            >
              <option value="fast">fast</option>
              <option value="strict">strict</option>
              <option value="low_cost">low_cost</option>
            </select>
          </label>
          <label>
            Type:{" "}
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as typeof taskType)}
              style={styles.select}
            >
              <option value="code">code</option>
              <option value="writing">writing</option>
              <option value="analysis">analysis</option>
              <option value="general">general</option>
            </select>
          </label>
          <label>
            Difficulty:{" "}
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
              style={styles.select}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label>
            Test mode:{" "}
            <select
              value={testMode}
              onChange={(e) => setTestMode(e.target.value as TestMode)}
              style={styles.select}
            >
              <option value="none">none</option>
              <option value="uncertain">uncertain (validator fail)</option>
              <option value="fail">fail (executor error)</option>
            </select>
          </label>
          <label>
            minQuality:{" "}
            <input
              type="number"
              step={0.01}
              value={minQuality}
              onChange={(e) => setMinQuality(e.target.value)}
              placeholder="minQuality (e.g. 0.85)"
              style={styles.numInput}
            />
          </label>
          <label>
            maxCostUSD:{" "}
            <input
              type="number"
              step={0.001}
              value={maxCostUSD}
              onChange={(e) => setMaxCostUSD(e.target.value)}
              placeholder="maxCostUSD (e.g. 0.01)"
              style={styles.numInput}
            />
          </label>
        </div>
      </header>

      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === "user" ? styles.userMessage : styles.assistantMessage),
            }}
          >
            {msg.role === "user" ? (
              <p style={styles.messageText}>{msg.content}</p>
            ) : msg.executiveCouncil ? (
              <ExecutiveCouncilCard result={msg.executiveCouncil} />
            ) : msg.projectEstimate ? (
              <ProjectEstimateCard estimate={msg.projectEstimate} />
            ) : msg.projectResult ? (
              <ProjectResultCard result={msg.projectResult} />
            ) : msg.result ? (
              <ResultCard
                result={msg.result}
                requestContext={msg.requestContext}
                onForceRunComplete={(newResult) =>
                  setMessages((m) => [...m, { role: "assistant", content: "", result: newResult }])
                }
              />
            ) : (
              <p style={styles.messageText}>{msg.content}</p>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ ...styles.message, ...styles.assistantMessage }}>
            <p style={styles.messageText}>Running...</p>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div style={styles.inputArea}>
      <div style={styles.inputRow}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          style={styles.input}
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading} style={styles.button}>
          Send
        </button>
      </div>

      <div style={styles.jsonTestRow}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={'{"directive":"...","taskType":"writing|analysis|code|general","difficulty":"low|medium|high","profile":"fast|strict|low_cost","projectBudgetUSD":0.05,"estimateOnly":true}'}
            style={styles.jsonTextarea}
            disabled={loading}
            rows={4}
          />
          <small style={{ color: "#666", fontSize: 11 }}>
            Estimate mode: include <code>{"\"estimateOnly\": true"}</code> with projectBudgetUSD. Budget alone → run.
          </small>
        </div>
        <button
          onClick={handleSendJson}
          disabled={loading}
          style={styles.jsonSendBtn}
        >
          SEND
        </button>
      </div>
      </div>
    </div>
  );
}

function ProjectEstimateCard({ estimate }: { estimate: ProjectEstimate }) {
  return (
    <div style={styles.resultCard}>
      <div style={styles.resultSummary}>
        <strong>status:</strong> {estimate.status} |{" "}
        <strong>totalEstimatedCost:</strong> $
        {estimate.totalEstimatedCostUSD.toFixed(4)} |{" "}
        <strong>predictedAvgQuality:</strong>{" "}
        {estimate.predictedAverageQuality.toFixed(3)} |{" "}
        <strong>predictedROI:</strong> {estimate.predictedROI.toFixed(2)}
      </div>
      <div style={styles.routingDetails}>
        <div><strong>Per-subtask:</strong></div>
        {estimate.subtasks.map((s) => (
          <div key={s.id} style={{ marginTop: 8, fontSize: 13 }}>
            <strong>{s.title}</strong> | model: {s.selectedModelId} | cost: $
            {s.estimatedCostUSD.toFixed(4)} | quality: {s.predictedQuality.toFixed(3)} |
            ROI: {s.predictedROI.toFixed(2)} | importance: {s.importance} | tier:{" "}
            {s.recommendedTier} | allocated: ${s.allocatedBudgetUSD.toFixed(4)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ExecutiveCouncilCard({ result }: { result: ExecutiveCouncilResult }) {
  const [showDrafts, setShowDrafts] = useState(false);
  const { run, brief, gate } = result;
  const rec = brief?.recommendedOptionId ?? run.consensus?.parsed?.recommendedOptionId;
  const questions = brief?.questionsForCEO ?? gate.requiredQuestions ?? run.consensus?.parsed?.questionsForCEO ?? [];
  const budget = brief?.downstreamBudgetEstimateUSD ?? run.consensus?.parsed?.downstreamBudgetEstimateUSD;

  return (
    <div style={styles.resultCard}>
      <div style={styles.resultSummary}>
        <strong>Gate:</strong> {gate.status} |{" "}
        <strong>Score:</strong> {(run.scoring?.overall ?? 0).toFixed(2)} |{" "}
        <strong>Recommended:</strong> {rec ?? "—"} |{" "}
        {run.totalActualCostUSD != null && (
          <>
            <strong>Cost:</strong> ${run.totalActualCostUSD.toFixed(4)} |{" "}
          </>
        )}
      </div>
      <div style={styles.routingDetails}>
        {budget && (
          <div style={{ marginBottom: 8 }}>
            <strong>Budget estimate:</strong> ${budget.low.toFixed(2)}–${budget.high.toFixed(2)} (likely: ${budget.likely.toFixed(2)})
          </div>
        )}
        {questions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <strong>Questions for CEO:</strong>
            <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
              {questions.slice(0, 5).map((q, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{q}</li>
              ))}
              {questions.length > 5 && <li style={{ color: "#666" }}>+{questions.length - 5} more</li>}
            </ul>
          </div>
        )}
        {gate.notes?.length > 0 && (
          <div style={{ marginBottom: 8, fontSize: 12, color: "#555" }}>
            {gate.notes.join("; ")}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowDrafts((s) => !s)}
        style={styles.toggleBtn}
      >
        {showDrafts ? "Hide drafts" : "Show drafts"}
      </button>
      {showDrafts && (
        <div style={styles.attemptsList}>
          {run.drafts?.map((d, i) => (
            <div key={i} style={styles.attempt}>
              <strong>{d.modelId}</strong>
              <pre style={{ ...styles.pre, marginTop: 8, maxHeight: 200 }}>{d.text || "(empty)"}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectResultCard({ result }: { result: ProjectResult }) {
  const [showSubtasks, setShowSubtasks] = useState(false);
  return (
    <div style={styles.resultCard}>
      <div style={styles.resultSummary}>
        <strong>status:</strong> {result.status} |{" "}
        <strong>totalCost:</strong> ${result.totalActualCostUSD.toFixed(4)} |{" "}
        <strong>subtasks:</strong> {result.subtasks.length}
      </div>
      <div style={styles.routingDetails}>
        <div><strong>finalOutput:</strong></div>
        <pre style={{ ...styles.pre, marginTop: 8 }}>{result.finalOutput || "(empty)"}</pre>
      </div>
      <button
        type="button"
        onClick={() => setShowSubtasks((s) => !s)}
        style={styles.toggleBtn}
      >
        {showSubtasks ? "Hide subtasks" : "Show subtasks"}
      </button>
      {showSubtasks && (
        <div style={styles.attemptsList}>
          {result.subtasks.map(({ subtask, result: subResult, forecast, actual, variance }) => (
            <div key={subtask.id} style={styles.attempt}>
              <div>
                <strong>{subtask.title}</strong> | {subResult.final.status} |{" "}
                importance: {subtask.importance} |{" "}
                allocatedBudget: ${(subtask.allocatedBudgetUSD ?? 0).toFixed(4)} |{" "}
                tier: {subtask.recommendedTier ?? "—"}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                Forecast cost: {forecast?.estimatedCostUSD != null ? `$${forecast.estimatedCostUSD.toFixed(4)}` : "—"} |{" "}
                Actual cost: {actual?.actualCostUSD != null ? `$${actual.actualCostUSD.toFixed(4)}` : "—"} |{" "}
                Cost Δ: {variance?.costDeltaUSD != null ? `$${variance.costDeltaUSD.toFixed(4)}` : "—"}
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color: "#555" }}>
                Predicted quality: {forecast?.predictedQuality != null ? forecast.predictedQuality.toFixed(3) : "—"} |{" "}
                Actual quality: {actual?.actualQuality != null ? actual.actualQuality.toFixed(3) : "—"} |{" "}
                Quality Δ: {variance?.qualityDelta != null ? variance.qualityDelta.toFixed(3) : "—"}
              </div>
              <ResultCard
                result={subResult}
                onForceRunComplete={() => {}}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ForceRunButton({
  modelId,
  requestContext,
  onComplete,
}: {
  modelId: string;
  requestContext: RequestContext;
  onComplete: (result: RunLogEvent) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/force-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: requestContext.message,
          taskType: requestContext.taskType,
          difficulty: requestContext.difficulty,
          profile: requestContext.profile,
          constraints: requestContext.constraints,
          modelId,
        }),
      });
      const result = (await res.json()) as RunLogEvent & { error?: string };
      if (!res.ok) throw new Error(result?.error ?? "Request failed");
      onComplete(result);
    } catch (err) {
      console.error("Force run failed:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      style={styles.forceRunBtn}
    >
      {loading ? "Running…" : `Run with ${modelId}`}
    </button>
  );
}

function AttemptOutput({ outputText }: { outputText: string }) {
  const [showOutput, setShowOutput] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const isLong = outputText.length > OUTPUT_TRUNCATE_LEN;
  const displayText =
    showMore || !isLong ? outputText : outputText.slice(0, OUTPUT_TRUNCATE_LEN) + "...";

  return (
    <div style={styles.outputBlock}>
      <button
        type="button"
        onClick={() => setShowOutput((s) => !s)}
        style={styles.toggleBtn}
      >
        {showOutput ? "Hide output" : "Show output"}
      </button>
      {showOutput && (
        <div style={styles.outputContent}>
          <pre style={styles.pre}>{displayText || "(empty)"}</pre>
          {isLong && !showMore && (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              style={styles.showMoreBtn}
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  result,
  requestContext,
  onForceRunComplete,
}: {
  result: RunLogEvent;
  requestContext?: RequestContext;
  onForceRunComplete: (newResult: RunLogEvent) => void;
}) {
  const { routing } = result;
  const costValue = result.actualCostUSD ?? result.expectedCostUSD;
  const cost =
    costValue != null
      ? `$${formatCost(costValue)} (${result.actualCostUSD != null ? "actual" : "estimated"})`
      : "N/A (estimated)";
  const routingExpectedCost =
    routing.expectedCostUSD != null
      ? `$${formatCost(routing.expectedCostUSD)} (estimated)`
      : "N/A (estimated)";
  const routingChosen = routing.chosenModelId ?? "(none)";
  const finalChosen = result.final.chosenModelId ?? "(none)";
  const fallbacksStr = routing.fallbackModelIds?.length
    ? routing.fallbackModelIds.join(", ")
    : "(none)";
  const tokens =
    routing.estimatedTokens != null
      ? `input=${routing.estimatedTokens.input}, output=${routing.estimatedTokens.output}`
      : "—";

  return (
    <div style={styles.resultCard}>
      <div style={styles.resultSummary}>
        <strong>status:</strong> {result.final.status} |{" "}
        <strong>routing:</strong> {routingChosen} |{" "}
        <strong>final:</strong> {finalChosen} |{" "}
        <strong>cost:</strong> {cost} |{" "}
        <strong>attempts:</strong> {result.attempts.length}
      </div>
      <div style={styles.routingDetails}>
        <div><strong>routing.status:</strong> {routing.status}</div>
        <div><strong>routing.chosenModelId:</strong> {routingChosen}</div>
        <div><strong>routing.fallbackModelIds:</strong> {fallbacksStr}</div>
        <div><strong>routing.estimatedTokens:</strong> {tokens}</div>
        <div><strong>routing.expectedCostUSD:</strong> {routingExpectedCost}</div>
        <div><strong>routing.rationale:</strong> {routing.rationale}</div>
      </div>
      {requestContext &&
        routing.fallbackModelIds?.length > 0 && (
          <div style={styles.forceRunRow}>
            {routing.fallbackModelIds.map((mid) => (
              <ForceRunButton
                key={mid}
                modelId={mid}
                requestContext={requestContext}
                onComplete={onForceRunComplete}
              />
            ))}
          </div>
        )}
      <div style={styles.attemptsList}>
        {result.attempts.map((a) => (
          <div key={a.attempt} style={styles.attempt}>
            <div>
              <strong>Attempt {a.attempt}</strong> {a.modelId} | execution:{" "}
              {a.execution.status} | validation: {a.validation.ok ? "ok" : "fail"}
            </div>
            {a.validation.reasons.length > 0 && (
              <div style={styles.reasons}>
                {a.validation.reasons.join("; ")}
              </div>
            )}
            <AttemptOutput outputText={a.execution.outputText ?? ""} />
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 720,
    margin: "0 auto",
    padding: 0,
    fontFamily: "system-ui, sans-serif",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 10,
    padding: "20px 24px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  navLink: {
    fontSize: 13,
    padding: "8px 16px",
    color: "#1976d2",
    textDecoration: "none",
    fontWeight: 500,
  },
  clearBtn: {
    fontSize: 13,
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    backgroundColor: "#fff",
    color: "#475569",
    fontWeight: 500,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: "#1e293b",
  },
  controls: {
    fontSize: 13,
    flexWrap: "wrap",
    display: "flex",
    alignItems: "center",
    gap: "12px 20px",
    color: "#475569",
  },
  select: {
    padding: "8px 12px",
    marginLeft: 4,
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    backgroundColor: "#fff",
    color: "#334155",
    fontSize: 13,
  },
  numInput: {
    width: 100,
    padding: "8px 12px",
    marginLeft: 4,
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    backgroundColor: "#fff",
    color: "#334155",
    fontSize: 13,
  },
  messages: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "20px 24px",
  },
  inputArea: {
    flexShrink: 0,
    padding: "16px 24px 24px",
    backgroundColor: "#f8f9fa",
    borderTop: "1px solid #e9ecef",
  },
  message: {
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    maxWidth: "90%",
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#e3f2fd",
  },
  assistantMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#f5f5f5",
  },
  messageText: {
    margin: 0,
  },
  inputRow: {
    display: "flex",
    gap: 8,
    paddingTop: 12,
  },
  input: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    borderRadius: 8,
    border: "1px solid #ccc",
  },
  button: {
    padding: "12px 24px",
    fontSize: 16,
    borderRadius: 8,
    border: "none",
    backgroundColor: "#1976d2",
    color: "white",
    cursor: "pointer",
  },
  jsonTestRow: {
    display: "flex",
    gap: 8,
    paddingTop: 12,
    alignItems: "flex-start",
  },
  jsonTextarea: {
    flex: 1,
    padding: 12,
    fontSize: 13,
    fontFamily: "monospace",
    borderRadius: 8,
    border: "1px solid #ccc",
    resize: "vertical",
    minHeight: 80,
  },
  jsonSendBtn: {
    padding: "12px 24px",
    fontSize: 14,
    fontWeight: "bold",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#2e7d32",
    color: "white",
    cursor: "pointer",
    alignSelf: "flex-end",
  },
  resultCard: {
    padding: 8,
  },
  resultSummary: {
    fontSize: 14,
    marginBottom: 12,
  },
  forceRunRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  forceRunBtn: {
    fontSize: 12,
    padding: "4px 12px",
    cursor: "pointer",
    border: "1px solid #1976d2",
    borderRadius: 4,
    backgroundColor: "#fff",
    color: "#1976d2",
  },
  routingDetails: {
    fontSize: 12,
    marginBottom: 12,
    padding: 8,
    backgroundColor: "#fafafa",
    borderRadius: 4,
  },
  attemptsList: {
    fontSize: 13,
  },
  attempt: {
    marginBottom: 8,
    padding: 8,
    backgroundColor: "#fff",
    borderRadius: 4,
  },
  reasons: {
    marginTop: 4,
    color: "#c62828",
    fontSize: 12,
  },
  outputBlock: {
    marginTop: 8,
  },
  toggleBtn: {
    fontSize: 12,
    padding: "2px 8px",
    cursor: "pointer",
    background: "none",
    border: "1px solid #999",
    borderRadius: 4,
  },
  outputContent: {
    marginTop: 6,
  },
  pre: {
    margin: 0,
    padding: 8,
    fontSize: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 4,
    overflow: "auto",
    maxHeight: 300,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  showMoreBtn: {
    marginTop: 4,
    fontSize: 12,
    padding: "2px 8px",
    cursor: "pointer",
    background: "none",
    border: "1px solid #999",
    borderRadius: 4,
  },
};
