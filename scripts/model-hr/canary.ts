#!/usr/bin/env node
/**
 * Model HR Canary Runner CLI
 *
 * Usage:
 *   npm run model-hr:canary -- --model gpt-4o-mini
 *   npm run model-hr:canary -- --model gpt-4o-mini --suite default
 *   npm run model-hr:canary -- --model gpt-4o-mini --apply
 *
 * Without --apply: only prints the recommendation.
 * With --apply: applies status changes (probation/active) and emits MODEL_HR_SIGNAL.
 */

import { runCanary } from "../../src/lib/model-hr/canary/canaryRunner.js";
import { evaluateSuiteForStatusChange } from "../../src/lib/model-hr/canary/canaryPolicy.js";
import { getModel, setModelStatus, emitModelHrSignal } from "../../src/lib/model-hr/index.js";

function parseArgs(): { model: string; suite: string; apply: boolean } {
  const args = process.argv.slice(2);
  let model = "";
  let suite = "default";
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === "--suite" && args[i + 1]) {
      suite = args[++i];
    } else if (args[i] === "--apply") {
      apply = true;
    }
  }
  return { model, suite, apply };
}

async function main(): Promise<void> {
  const { model, suite, apply } = parseArgs();
  if (!model) {
    console.error("Usage: npm run model-hr:canary -- --model <modelId> [--suite default] [--apply]");
    process.exit(1);
  }

  const suiteResult = await runCanary({ modelId: model, suiteId: suite });
  const output = JSON.stringify(suiteResult, null, 2);
  console.log(output);

  const current = await getModel(model);
  const policy = evaluateSuiteForStatusChange(model, suiteResult, current?.governance ?? undefined);
  console.error(`\nPolicy: ${policy.action} (${policy.reason})`);

  if (apply && policy.action !== "none") {
    const previousStatus = current?.identity?.status ?? "unknown";
    if (policy.action === "probation") {
      const updated = await setModelStatus(model, "probation");
      if (updated) {
        try {
          emitModelHrSignal({
            modelId: model,
            previousStatus,
            newStatus: "probation",
            reason: "canary_regression",
            sampleCount: suiteResult.results.length,
          });
        } catch {
          /* never fail */
        }
        console.error(`Applied: set ${model} to probation`);
      }
    } else if (policy.action === "active") {
      const updated = await setModelStatus(model, "active");
      if (updated) {
        try {
          emitModelHrSignal({
            modelId: model,
            previousStatus,
            newStatus: "active",
            reason: "canary_graduate",
            sampleCount: suiteResult.results.length,
          });
        } catch {
          /* never fail */
        }
        console.error(`Applied: set ${model} to active`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/*
Example output (mocked):

{
  "suiteId": "default",
  "modelId": "gpt-4o-mini",
  "results": [
    {
      "modelId": "gpt-4o-mini",
      "taskId": "write-summary",
      "pass": true,
      "qualityScore": 1,
      "defects": [],
      "latencyMs": 342,
      "costUSD": 0.00012,
      "tsISO": "2025-02-14T18:00:00.000Z"
    },
    {
      "modelId": "gpt-4o-mini",
      "taskId": "code-hello",
      "pass": true,
      "qualityScore": 1,
      "defects": [],
      "latencyMs": 210,
      "costUSD": 0.00008,
      "tsISO": "2025-02-14T18:00:01.000Z"
    }
  ],
  "pass": true,
  "avgQuality": 0.95,
  "failedCount": 0
}

Policy: active (canary_graduate)
*/
