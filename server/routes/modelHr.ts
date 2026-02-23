/**
 * Model HR API routes - Express handlers.
 */

import type { Request, Response } from "express";
import type { ModelRegistryEntry } from "../../src/lib/model-hr/types.js";
import {
  getRegistryFallbackCountLastHours,
  getLastRegistryLoadDiagnostics,
  getRegistryPathForDisplay,
  listModels,
  upsertModel,
  getModel,
  emitModelHrSignal,
} from "../../src/lib/model-hr/index.js";
import { z } from "zod";

export function healthGet(_req: Request, res: Response) {
  getRegistryFallbackCountLastHours(24)
    .then((fallbackCount24h) => {
      const lastDiagnostics = getLastRegistryLoadDiagnostics();
      const registryPath = getRegistryPathForDisplay();
      res.json({
        registryHealth: fallbackCount24h > 0 ? "FALLBACK" : "OK",
        fallbackCount24h,
        lastRegistryLoadError: lastDiagnostics
          ? { reasonCode: lastDiagnostics.reasonCode, message: lastDiagnostics.message }
          : null,
        registryFileInfo: lastDiagnostics
          ? {
              path: lastDiagnostics.path,
              exists: lastDiagnostics.fileExists,
              sizeBytes: lastDiagnostics.fileSizeBytes,
              mtimeISO: lastDiagnostics.fileMtimeISO,
            }
          : { path: registryPath, exists: null, sizeBytes: null, mtimeISO: null },
      });
    })
    .catch((e) => {
      res.status(500).json({
        registryHealth: "UNKNOWN",
        fallbackCount24h: 0,
        error: e instanceof Error ? e.message : "Unknown",
      });
    });
}

const ListQuerySchema = z.object({
  includeDisabled: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  status: z.string().optional(),
  provider: z.string().optional(),
});

const ModelIdentitySchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  version: z.string().optional(),
  status: z.enum(["active", "probation", "deprecated", "disabled"]),
  releasedAtISO: z.string().optional(),
  deprecatedAtISO: z.string().optional(),
  disabledAtISO: z.string().optional(),
  disabledReason: z.string().optional(),
});

const ModelPricingSchema = z.object({
  inPer1k: z.number().nonnegative(),
  outPer1k: z.number().nonnegative(),
  currency: z.string().default("USD"),
  minimumChargeUSD: z.number().nonnegative().optional(),
  roundingRule: z.enum(["perToken", "per1k", "perRequest"]).optional(),
});

const UpsertBodySchema = z.object({
  id: z.string().min(1),
  identity: ModelIdentitySchema,
  displayName: z.string().optional(),
  pricing: ModelPricingSchema,
  expertise: z.record(z.string(), z.number()).optional(),
  reliability: z.number().min(0).max(1).optional(),
  capabilities: z
    .object({
      modalities: z.array(z.enum(["text", "image", "audio", "vision"])).optional(),
      toolUse: z.boolean().optional(),
      jsonReliability: z.enum(["native", "prompted", "unreliable"]).optional(),
      contextWindowTokens: z.number().int().positive().optional(),
      functionCalling: z.boolean().optional(),
      streaming: z.boolean().optional(),
      reasoning: z.boolean().optional(),
    })
    .optional(),
  guardrails: z.record(z.string(), z.unknown()).optional(),
  operational: z.record(z.string(), z.unknown()).optional(),
  performancePriors: z.array(z.record(z.string(), z.unknown())).optional(),
  governance: z.record(z.string(), z.unknown()).optional(),
  evaluationMeta: z.record(z.string(), z.unknown()).optional(),
});

export async function registryGet(req: Request, res: Response) {
  try {
    const query = ListQuerySchema.safeParse(req.query);
    const filters = query.success
      ? {
          includeDisabled: query.data.includeDisabled,
          ...(query.data.status && {
            status: query.data.status as "active" | "probation" | "deprecated" | "disabled",
          }),
          ...(query.data.provider && { provider: query.data.provider }),
        }
      : undefined;
    const models = await listModels(filters);
    res.json({ success: true, models });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

function paramId(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : (v ?? "");
}

export async function observationsGet(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Model id is required" },
      });
    }
    const limit = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50)
    );
    const { loadObservationsForModel } = await import("../../src/lib/model-hr/index.js");
    const observations = await loadObservationsForModel(id, limit);
    res.json({ success: true, observations: observations ?? [] });
  } catch {
    res.json({ success: true, observations: [] });
  }
}

export async function priorsGet(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Model id is required" },
      });
    }
    const { loadPriorsForModel } = await import("../../src/lib/model-hr/index.js");
    const priors = await loadPriorsForModel(id);
    res.json({ success: true, priors: priors ?? [] });
  } catch {
    res.json({ success: true, priors: [] });
  }
}

export async function signalsGet(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Model id is required" },
      });
    }
    const limit = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50)
    );
    const { readModelHrSignalsForModel } = await import("../../src/lib/model-hr/index.js");
    const signals = await readModelHrSignalsForModel(id, limit);
    res.json({ success: true, signals: signals ?? [] });
  } catch {
    res.json({ success: true, signals: [] });
  }
}

const StatusBodySchema = z.object({
  status: z.enum(["active", "probation"]),
});

const DisableBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
});

export async function statusPost(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Model id is required" },
      });
    }
    const raw = req.body ?? {};
    const parsed = StatusBodySchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message, details: parsed.error.issues },
      });
    }
    const { setModelStatus } = await import("../../src/lib/model-hr/index.js");
    const model = await setModelStatus(id, parsed.data.status);
    if (!model) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Model not found: ${id}`, details: { modelId: id } },
      });
    }
    res.json({ success: true, model });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function disablePost(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Model id is required" },
      });
    }
    const raw = req.body ?? {};
    const parsed = DisableBodySchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message, details: parsed.error.issues },
      });
    }
    const { disableModel } = await import("../../src/lib/model-hr/index.js");
    const model = await disableModel(id, parsed.data.reason);
    if (!model) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Model not found: ${id}`, details: { modelId: id } },
      });
    }
    res.json({ success: true, model });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function analyticsGet(req: Request, res: Response) {
  try {
    const windowHours = Math.min(
      Math.max(1, parseInt(String(req.query.windowHours ?? "24"), 10) || 24),
      720
    );
    const { buildModelHrAnalytics } = await import("../../src/lib/model-hr/analytics/index.js");
    const { getRunLedgerStore } = await import("../../src/lib/observability/runLedger.js");
    const ledgerStore = getRunLedgerStore();
    const analytics = await buildModelHrAnalytics(windowHours, ledgerStore);
    res.json(analytics);
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function actionsGet(req: Request, res: Response) {
  try {
    const limit = Math.min(
      parseInt(String(req.query.limit ?? "100"), 10) || 100,
      500
    );
    const { listActions } = await import("../../src/lib/model-hr/index.js");
    const actions = await listActions(limit);
    res.json({ success: true, actions });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

const ApproveBodySchema = z.object({
  approvedBy: z.string().min(1, "approvedBy is required"),
});

const RejectBodySchema = z.object({
  rejectedBy: z.string().min(1, "rejectedBy is required"),
  reason: z.string().optional(),
});

export async function actionApprovePost(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Action id is required" },
      });
    }
    const raw = req.body ?? {};
    const parsed = ApproveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message, details: parsed.error.issues },
      });
    }
    const { approveAction, getActionById, makeRegistryService } = await import("../../src/lib/model-hr/index.js");
    const action = await getActionById(id);
    if (!action) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Action not found: ${id}`, details: { actionId: id } },
      });
    }
    const registry = makeRegistryService() as Parameters<typeof approveAction>[2];
    const result = await approveAction(id, parsed.data.approvedBy, registry);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: "APPROVE_FAILED", message: result.error ?? "Approval failed" },
      });
    }
    res.json({ success: true, action: result.action });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function actionRejectPost(req: Request, res: Response) {
  try {
    const id = paramId(req, "id");
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Action id is required" },
      });
    }
    const raw = req.body ?? {};
    const parsed = RejectBodySchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message, details: parsed.error.issues },
      });
    }
    const { rejectAction, getActionById } = await import("../../src/lib/model-hr/index.js");
    const action = await getActionById(id);
    if (!action) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Action not found: ${id}`, details: { actionId: id } },
      });
    }
    const result = await rejectAction(id, parsed.data.rejectedBy, parsed.data.reason);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: "REJECT_FAILED", message: result.error ?? "Rejection failed" },
      });
    }
    res.json({ success: true, action: result.action });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function signalsListGet(req: Request, res: Response) {
  try {
    const limit = Math.min(
      500,
      Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100)
    );
    const { readModelHrSignals } = await import("../../src/lib/model-hr/index.js");
    const signals = await readModelHrSignals(limit);
    res.json({ success: true, signals });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}

export async function registryPost(req: Request, res: Response) {
  try {
    const raw = req.body;
    if (raw == null || typeof raw !== "object") {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Request body must be a JSON object" },
      });
    }
    const parsed = UpsertBodySchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message, details: parsed.error.issues },
      });
    }
    const data = parsed.data;
    const existing = await getModel(data.id);
    const killSwitchNow = (data.governance as { killSwitch?: boolean })?.killSwitch === true;
    const killSwitchWas = (existing?.governance as { killSwitch?: boolean })?.killSwitch === true;
    if (killSwitchNow && !killSwitchWas) {
      try {
        emitModelHrSignal({
          modelId: data.id,
          previousStatus: existing?.identity?.status ?? "unknown",
          newStatus: "kill_switch",
          reason: "kill_switch",
        });
      } catch {
        /* never fail request */
      }
    }
    const now = new Date().toISOString();
    const entry = { ...data, createdAtISO: now, updatedAtISO: now } as ModelRegistryEntry;
    const saved = await upsertModel(entry);
    res.json({ success: true, model: saved });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "Internal server error" },
    });
  }
}
