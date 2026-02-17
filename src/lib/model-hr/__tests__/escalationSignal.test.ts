/**
 * Tests for escalation-to-signal feedback loop.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { emitEscalationSignal, readModelHrSignals } from "../signals/signalLog.js";

describe("escalation signal", () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    testDir = join(tmpdir(), `model-hr-escalation-signal-${Date.now()}`);
    process.env.MODEL_HR_DATA_DIR = testDir;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("emitEscalationSignal appends signal to file", async () => {
    emitEscalationSignal("gpt-4o", "escalation_quality_drop", {
      packageId: "pkg-1",
      runSessionId: "run-123",
    });
    await new Promise((r) => setTimeout(r, 100));
    const signals = await readModelHrSignals(10);
    const escalation = signals.find(
      (s) => s.modelId === "gpt-4o" && s.reason === "escalation_quality_drop"
    );
    expect(escalation).toBeDefined();
    expect(escalation!.previousStatus).toBe("n/a");
    expect(escalation!.newStatus).toBe("n/a");
    expect(escalation!.tsISO).toBeDefined();
  });

  it("emitEscalationSignal with context includes context in stored signal", async () => {
    emitEscalationSignal("claude-3", "escalation_budget_exceeded", {
      packageId: "pkg-2",
      runSessionId: "run-456",
    });
    await new Promise((r) => setTimeout(r, 100));
    const signals = await readModelHrSignals(10);
    const escalation = signals.find(
      (s) => s.modelId === "claude-3" && s.reason === "escalation_budget_exceeded"
    );
    expect(escalation).toBeDefined();
    expect((escalation as { context?: Record<string, unknown> }).context).toEqual({
      packageId: "pkg-2",
      runSessionId: "run-456",
    });
  });

  it("emitEscalationSignal never throws", () => {
    process.env.MODEL_HR_DATA_DIR = "/nonexistent/path/that/cannot/be/created";
    expect(() => {
      emitEscalationSignal("test-model", "escalation_switch_model");
    }).not.toThrow();
  });
});
