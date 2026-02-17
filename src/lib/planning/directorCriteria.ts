/**
 * Director acceptance criteria templates per taskType and difficulty.
 * Deterministic, testable criteria; no LLM calls.
 */

// ─── src/lib/planning/directorCriteria.ts ───────────────────────────────────

export type TaskType =
  | "implementation"
  | "research"
  | "review"
  | "documentation"
  | "strategy";

export type Difficulty = "low" | "medium" | "high";

const CRITERIA: Record<TaskType, Record<Difficulty, string[]>> = {
  implementation: {
    low: [
      "Deliverable matches the stated description and scope",
      "Code or artifact compiles and runs without errors",
      "Output conforms to the specified format or structure",
      "Basic edge cases are handled",
    ],
    medium: [
      "Deliverable matches the stated description and scope",
      "Code or artifact compiles and runs without errors",
      "Output conforms to the specified format or structure",
      "Edge cases and common failure modes are addressed",
      "Implementation is testable and maintainable",
    ],
    high: [
      "Deliverable matches the stated description and scope",
      "Code or artifact compiles and runs without errors",
      "Output conforms to the specified format or structure",
      "Edge cases and common failure modes are addressed",
      "Implementation is testable and maintainable",
      "Documentation or rationale supports key design decisions",
      "Security and performance considerations are addressed where relevant",
    ],
  },
  research: {
    low: [
      "Findings directly address the research question",
      "Sources or evidence are cited where applicable",
      "Conclusions are clearly stated and supported",
    ],
    medium: [
      "Findings directly address the research question",
      "Sources or evidence are cited where applicable",
      "Conclusions are clearly stated and supported",
      "Alternative perspectives or limitations are acknowledged",
      "Recommendations are actionable and specific",
    ],
    high: [
      "Findings directly address the research question",
      "Sources or evidence are cited where applicable",
      "Conclusions are clearly stated and supported",
      "Alternative perspectives or limitations are acknowledged",
      "Recommendations are actionable and specific",
      "Methodology is reproducible and well-documented",
      "Risk and uncertainty are quantified or explicitly discussed",
    ],
  },
  review: {
    low: [
      "Review covers all stated scope and deliverables",
      "Feedback is specific and actionable",
      "Pass/fail or quality assessment is clearly stated",
    ],
    medium: [
      "Review covers all stated scope and deliverables",
      "Feedback is specific and actionable",
      "Pass/fail or quality assessment is clearly stated",
      "Defects or issues are prioritized by severity",
      "Suggestions for improvement are concrete",
    ],
    high: [
      "Review covers all stated scope and deliverables",
      "Feedback is specific and actionable",
      "Pass/fail or quality assessment is clearly stated",
      "Defects or issues are prioritized by severity",
      "Suggestions for improvement are concrete",
      "Review methodology and criteria are documented",
      "Compliance or standards alignment is verified where applicable",
    ],
  },
  documentation: {
    low: [
      "Documentation matches the stated scope and audience",
      "Content is accurate and up to date",
      "Format and structure are consistent",
    ],
    medium: [
      "Documentation matches the stated scope and audience",
      "Content is accurate and up to date",
      "Format and structure are consistent",
      "Examples or use cases are included where helpful",
      "Navigation and discoverability are adequate",
    ],
    high: [
      "Documentation matches the stated scope and audience",
      "Content is accurate and up to date",
      "Format and structure are consistent",
      "Examples or use cases are included where helpful",
      "Navigation and discoverability are adequate",
      "Versioning and maintenance plan are addressed",
      "Accessibility and localization considerations are met where applicable",
    ],
  },
  strategy: {
    low: [
      "Strategy addresses the stated objective",
      "Options or alternatives are presented",
      "Recommendation is clearly stated with rationale",
    ],
    medium: [
      "Strategy addresses the stated objective",
      "Options or alternatives are presented",
      "Recommendation is clearly stated with rationale",
      "Risks and mitigations are identified",
      "Success criteria and metrics are defined",
    ],
    high: [
      "Strategy addresses the stated objective",
      "Options or alternatives are presented",
      "Recommendation is clearly stated with rationale",
      "Risks and mitigations are identified",
      "Success criteria and metrics are defined",
      "Implementation roadmap or phasing is outlined",
      "Stakeholder impact and change management are considered",
    ],
  },
};

/**
 * Returns 4–7 acceptance criteria for the given taskType and difficulty.
 * Criteria are specific and testable.
 */
export function getAcceptanceCriteria(
  taskType: TaskType,
  difficulty: Difficulty
): string[] {
  return [...(CRITERIA[taskType]?.[difficulty] ?? CRITERIA.implementation.medium)];
}
