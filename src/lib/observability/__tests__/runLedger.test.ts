import { describe, it, expect, vi, afterEach } from "vitest";
import { getRunLedgerStore } from "../runLedger.js";

describe("runLedger finalizeLedger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when roleExecutions missing or empty", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = getRunLedgerStore();
    const runSessionId = "test-warn-" + Date.now();
    store.createLedger(runSessionId, { counts: { packagesTotal: 1, worker: 1, qa: 0 } });

    store.finalizeLedger(runSessionId, { completed: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("roleExecutions missing or empty")
    );

    warnSpy.mockClear();
    store.createLedger(runSessionId + "-2", { counts: { packagesTotal: 1, worker: 1, qa: 0 } });
    store.finalizeLedger(runSessionId + "-2", { completed: 1, roleExecutions: [] });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("roleExecutions missing or empty")
    );
  });

  it("does not warn when roleExecutions has items", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = getRunLedgerStore();
    const runSessionId = "test-ok-" + Date.now();
    store.createLedger(runSessionId, { counts: { packagesTotal: 1, worker: 1, qa: 0 } });
    store.finalizeLedger(runSessionId, {
      completed: 1,
      roleExecutions: [{ nodeId: "ceo", role: "ceo", status: "ok" }],
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
