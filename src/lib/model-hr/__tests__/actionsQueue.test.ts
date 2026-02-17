/**
 * Tests for HR Actions Queue: append, read, approve, reject.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  enqueueAction,
  listActions,
  getActionById,
  approveAction,
  rejectAction,
} from "../actions/actionsQueue.js";
import { RegistryService } from "../registry/registryService.js";
import { InMemoryStorageAdapter } from "./inMemoryStorage.js";
import type { ModelRegistryEntry } from "../types.js";

const TEST_DIR = join(tmpdir(), `model-hr-actions-test-${Date.now()}`);

const MODEL: ModelRegistryEntry = {
  id: "openai/gpt-4o",
  identity: { provider: "openai", modelId: "gpt-4o", status: "probation" },
  displayName: "GPT-4o",
  pricing: { inPer1k: 0.0025, outPer1k: 0.01, currency: "USD" },
  expertise: { general: 0.9 },
  reliability: 0.9,
  createdAtISO: "2025-01-01T00:00:00.000Z",
  updatedAtISO: "2025-01-01T00:00:00.000Z",
};

describe("actionsQueue", () => {
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.MODEL_HR_DATA_DIR;
    process.env.MODEL_HR_DATA_DIR = TEST_DIR;
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    process.env.MODEL_HR_DATA_DIR = originalEnv;
  });

  describe("enqueueAction", () => {
    it("appends action to actions.jsonl", async () => {
      const entry = await enqueueAction("openai/gpt-4o", "disable", "auto_disabled_regression", "evaluation");
      expect(entry).not.toBeNull();
      expect(entry!.modelId).toBe("openai/gpt-4o");
      expect(entry!.action).toBe("disable");
      expect(entry!.reason).toBe("auto_disabled_regression");
      expect(entry!.recommendedBy).toBe("evaluation");
      expect(entry!.approved).toBe(false);
      expect(entry!.id).toBeDefined();
      expect(entry!.tsISO).toBeDefined();

      const path = join(TEST_DIR, "actions.jsonl");
      const raw = await readFile(path, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.modelId).toBe("openai/gpt-4o");
      expect(parsed.action).toBe("disable");
    });
  });

  describe("listActions", () => {
    it("returns empty array when file does not exist", async () => {
      try {
        await unlink(join(TEST_DIR, "actions.jsonl"));
      } catch {
        /* ignore */
      }
      const actions = await listActions(10);
      expect(actions).toEqual([]);
    });

    it("returns actions most recent last", async () => {
      try {
        await unlink(join(TEST_DIR, "actions.jsonl"));
      } catch {
        /* ignore */
      }
      await enqueueAction("m1", "disable", "r1", "evaluation");
      await enqueueAction("m2", "probation", "r2", "ops");
      const actions = await listActions(10);
      expect(actions).toHaveLength(2);
      expect(actions[0].modelId).toBe("m1");
      expect(actions[1].modelId).toBe("m2");
    });
  });

  describe("getActionById", () => {
    it("returns action by id", async () => {
      const entry = await enqueueAction("m1", "disable", "r1", "evaluation");
      expect(entry).not.toBeNull();
      const found = await getActionById(entry!.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(entry!.id);
      expect(found!.modelId).toBe("m1");
    });

    it("returns null for unknown id", async () => {
      const found = await getActionById("unknown-id");
      expect(found).toBeNull();
    });
  });

  describe("approveAction", () => {
    it("applies disable and marks approved", async () => {
      const storage = new InMemoryStorageAdapter([MODEL]);
      const registry = new RegistryService(storage);
      const entry = await enqueueAction("openai/gpt-4o", "disable", "test_disable", "evaluation");
      expect(entry).not.toBeNull();

      const result = await approveAction(entry!.id, "test-user", registry);
      expect(result.success).toBe(true);
      expect(result.action).not.toBeNull();
      expect(result.action!.approved).toBe(true);
      expect(result.action!.approvedBy).toBe("test-user");
      expect(result.action!.approvedAtISO).toBeDefined();

      const model = await registry.getModel("openai/gpt-4o");
      expect(model).not.toBeNull();
      expect(model!.identity.status).toBe("disabled");
    });

    it("is idempotent: approving twice returns success", async () => {
      const storage = new InMemoryStorageAdapter([MODEL]);
      const registry = new RegistryService(storage);
      const entry = await enqueueAction("openai/gpt-4o", "disable", "test_disable", "evaluation");
      expect(entry).not.toBeNull();

      const r1 = await approveAction(entry!.id, "user1", registry);
      expect(r1.success).toBe(true);
      const r2 = await approveAction(entry!.id, "user2", registry);
      expect(r2.success).toBe(true);
      expect(r2.action!.approvedBy).toBe("user1");
    });
  });

  describe("rejectAction", () => {
    it("marks action rejected", async () => {
      const entry = await enqueueAction("m1", "disable", "r1", "evaluation");
      expect(entry).not.toBeNull();

      const result = await rejectAction(entry!.id, "ops-user", "Manual override");
      expect(result.success).toBe(true);
      expect(result.action).not.toBeNull();
      expect(result.action!.rejectedBy).toBe("ops-user");
      expect(result.action!.rejectionReason).toBe("Manual override");
      expect(result.action!.rejectedAtISO).toBeDefined();
    });

    it("is idempotent: rejecting twice returns success", async () => {
      const entry = await enqueueAction("m1", "disable", "r1", "evaluation");
      expect(entry).not.toBeNull();

      const r1 = await rejectAction(entry!.id, "user1");
      expect(r1.success).toBe(true);
      const r2 = await rejectAction(entry!.id, "user2");
      expect(r2.success).toBe(true);
    });
  });
});
