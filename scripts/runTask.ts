#!/usr/bin/env node
/**
 * Run Task Router Demo
 * Uses MockExecutor + runTask() orchestrator.
 * Demonstrates: pass, validation failure + retry, no_qualified_models.
 */

import { runTask } from "../src/runTask.js";
import { mockExecutor } from "../src/executor/mockExecutor.js";
import { DEMO_CONFIG } from "../src/demoModels.js";
import { getModelRegistryForRuntime } from "../src/lib/model-hr/index.js";
import type { TaskCard } from "../src/types.js";

/** 1) Passes: code task, qualifies, executes, validates ok */
const TASK_PASS: TaskCard = {
  id: "task-pass",
  taskType: "code",
  difficulty: "low",
};

/** 2) Fails validation on first attempt, retries with fallback, passes */
const TASK_RETRY: TaskCard = {
  id: "task-uncertain",
  taskType: "analysis",
  difficulty: "low",
};

/** 3) Budget too low, no qualified models (onBudgetFail: fail) */
const TASK_NO_QUALIFIED: TaskCard = {
  id: "task-budget-fail",
  taskType: "analysis",
  difficulty: "medium",
  constraints: { maxCostUSD: 0.001 },
};

function printSummary(event: Awaited<ReturnType<typeof runTask>>): void {
  const routingChosen = event.routing.chosenModelId ?? "(none)";
  const finalChosen = event.final.chosenModelId ?? "(none)";
  const cost =
    event.expectedCostUSD != null
      ? `$${event.expectedCostUSD.toFixed(4)}`
      : "N/A";
  console.log(
    `  ${event.runId.slice(0, 8)} | ${event.final.status} | routing: ${routingChosen} | final: ${finalChosen} | ${event.attempts.length} attempts | ${cost}`
  );
  for (const a of event.attempts) {
    console.log(`    attempt ${a.attempt}: ${a.modelId} validation=${a.validation.ok}`);
  }
}

async function main(): Promise<void> {
  console.log("=== Task Router + Execution Pipeline ===\n");

  const { models } = await getModelRegistryForRuntime();

  const tasks = [
    { task: TASK_PASS, config: DEMO_CONFIG, directive: "Write a hello world function in JavaScript" },
    { task: TASK_RETRY, config: DEMO_CONFIG, directive: "__UNCERTAIN__" },
    { task: TASK_NO_QUALIFIED, config: { ...DEMO_CONFIG, onBudgetFail: "fail" as const } },
  ];

  for (const { task, config, directive } of tasks) {
    const event = await runTask({
      task,
      models,
      config,
      executor: mockExecutor,
      logPath: "./runs/runs.jsonl",
      directive,
    });
    printSummary(event);

    if (directive != null && directive.trim() && event.attempts.length > 0) {
      const firstPrompt = event.attempts[0].prompt;
      if (!firstPrompt.includes("User directive:")) {
        throw new Error("Sanity check failed: prompt should include 'User directive:' when directive supplied");
      }
    }
  }

  console.log("\nLogs written to ./runs/runs.jsonl");
}

main();
