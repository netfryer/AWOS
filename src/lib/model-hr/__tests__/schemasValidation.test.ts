/**
 * Tests for Model HR Zod schema validation.
 */

import { describe, it, expect } from "vitest";
import { ModelRegistryEntrySchema } from "../schemas.js";

const VALID_ENTRY = {
  id: "openai/gpt-4o",
  identity: { provider: "openai", modelId: "gpt-4o", status: "active" },
  displayName: "GPT-4o",
  pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
  expertise: { general: 0.9 },
  reliability: 0.9,
  createdAtISO: "2025-01-01T00:00:00.000Z",
  updatedAtISO: "2025-01-01T00:00:00.000Z",
};

describe("ModelRegistryEntrySchema", () => {
  it("valid entry passes safeParse", () => {
    const result = ModelRegistryEntrySchema.safeParse(VALID_ENTRY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("openai/gpt-4o");
      expect(result.data.identity.provider).toBe("openai");
      expect(result.data.pricing.inPer1k).toBe(0.0025);
    }
  });

  it("valid entry with optional fields passes", () => {
    const full = {
      ...VALID_ENTRY,
      governance: { allowedTiers: ["cheap", "standard"], minQualityPrior: 0.6 },
      capabilities: { toolUse: true },
    };
    const result = ModelRegistryEntrySchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("valid entry with passthrough extra fields passes", () => {
    const withExtra = { ...VALID_ENTRY, customField: "ignored" };
    const result = ModelRegistryEntrySchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customField).toBe("ignored");
    }
  });

  it("invalid entry fails: missing required id", () => {
    const invalid = { ...VALID_ENTRY, id: "" };
    const result = ModelRegistryEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("invalid entry fails: missing identity", () => {
    const invalid = { ...VALID_ENTRY, identity: undefined };
    const result = ModelRegistryEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("invalid entry fails: invalid status", () => {
    const invalid = {
      ...VALID_ENTRY,
      identity: { ...VALID_ENTRY.identity, status: "invalid_status" },
    };
    const result = ModelRegistryEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("invalid entry fails: negative pricing", () => {
    const invalid = {
      ...VALID_ENTRY,
      pricing: { inPer1k: -0.01, outPer1k: 0.01, currency: "USD" },
    };
    const result = ModelRegistryEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("invalid entry fails: missing createdAtISO", () => {
    const invalid = { ...VALID_ENTRY };
    delete (invalid as Record<string, unknown>).createdAtISO;
    const result = ModelRegistryEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("invalid entry fails: empty identity.provider", () => {
    const invalid = {
      ...VALID_ENTRY,
      identity: { provider: "", modelId: "gpt-4o", status: "active" },
    };
    const result = ModelRegistryEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
