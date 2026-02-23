import { describe, it, expect } from "vitest";
import { selectEscalationModel } from "../selectEscalationModel.js";

describe("selectEscalationModel", () => {
  it("returns next model in tier when current is in list", () => {
    const result = selectEscalationModel({
      taskType: "code",
      currentModelId: "gpt-4o-mini",
      availableModelIds: ["gpt-4o-mini", "claude-sonnet-4-5-20250929", "gpt-4o"],
    });
    expect(result.modelId).toBe("claude-sonnet-4-5-20250929");
    expect(result.reason).toContain("next_tier");
  });

  it("returns null when current is already top tier", () => {
    const result = selectEscalationModel({
      taskType: "code",
      currentModelId: "gpt-4o",
      availableModelIds: ["gpt-4o-mini", "claude-sonnet-4-5-20250929", "gpt-4o"],
    });
    expect(result.modelId).toBeNull();
    expect(result.reason).toBe("no_higher_tier_available");
  });

  it("when current not in list, picks first above cheapest tier", () => {
    const result = selectEscalationModel({
      taskType: "code",
      currentModelId: "claude-haiku-4-5-20251001",
      availableModelIds: ["gpt-4o-mini", "claude-sonnet-4-5-20250929", "gpt-4o", "claude-haiku-4-5-20251001"],
    });
    expect(result.modelId).toBeTruthy();
    expect(result.modelId).not.toBe("claude-haiku-4-5-20251001");
  });
});
