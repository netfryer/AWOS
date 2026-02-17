#!/usr/bin/env node
/**
 * Verification for token estimation and evaluator refusal penalty.
 * Run: npx tsx scripts/verifyFixes.ts
 */

import { estimateTokensForTask } from "../src/router.js";
import { evaluateOutput } from "../src/evaluator.js";
import { DEMO_CONFIG } from "../src/demoModels.js";
import type { TaskCard } from "../src/types.js";

const task: TaskCard = {
  id: "verify",
  taskType: "writing",
  difficulty: "medium",
};

const SHORT_DIRECTIVE = "Write a 500-word executive memo.";
const LONG_DIRECTIVE = "Write a 500-word executive strategy memo on AI transformation trends and provide recommendations.";

async function main(): Promise<void> {
  console.log("=== Fix Verification ===\n");

  const withDirective = estimateTokensForTask(task, SHORT_DIRECTIVE, DEMO_CONFIG);
  const withoutDirective = estimateTokensForTask(task, undefined, DEMO_CONFIG);

  console.log("1) Directive-based vs baseTokenEstimates:");
  console.log(`   With directive (${SHORT_DIRECTIVE.length} chars): input=${withDirective.input} output=${withDirective.output}`);
  console.log(`   Without directive (fallback): input=${withoutDirective.input} output=${withoutDirective.output}`);

  if (withDirective.input >= withoutDirective.input && withDirective.output >= withoutDirective.output) {
    console.log("   ⚠ Directive-based should typically be LOWER for short directives.");
  } else {
    console.log("   ✓ Directive-based produces lower estimates for short directives.");
  }

  console.log("\n2) Refusal penalty:");
  try {
    const r = await evaluateOutput({
      taskType: "writing",
      directive: "Write a memo",
      outputText: "I don't have access to that information. Please provide more details.",
    });
    if (r.qualityScore <= 0.1) {
      console.log("   ✓ Refusal output scored", r.qualityScore, "(penalized to ~0.05)");
    } else {
      console.log("   ✗ Expected ~0.05, got", r.qualityScore);
    }
  } catch (e) {
    console.error("   Error:", e);
  }
}

main();
