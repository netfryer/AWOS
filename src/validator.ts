/**
 * Minimal output validation. Intentionally simple, easy to replace later.
 */

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Validates execution output.
 * - analysis tasks: output must be at least 20 chars
 * - output must not contain "I am not sure"
 */
export function validate(outputText: string, taskType: string): ValidationResult {
  const reasons: string[] = [];

  if (taskType === "analysis" && outputText.length < 20) {
    reasons.push("analysis output too short (< 20 chars)");
  }

  if (outputText.includes("I am not sure")) {
    reasons.push('output contains "I am not sure"');
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
