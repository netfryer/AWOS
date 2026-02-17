// ─── app/api/ops/model-hr/registry/route.ts ─────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listModels,
  upsertModel,
  getModel,
  emitModelHrSignal,
} from "../../../../../dist/src/lib/model-hr/index.js";

function err400(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 400 }
  );
}

function err404(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 404 }
  );
}

function err500(code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status: 500 }
  );
}

const ListQuerySchema = z.object({
  includeDisabled: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  status: z.string().optional(),
  provider: z.string().optional(),
});

/** GET: list models (registry entries) */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = ListQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries())
    );
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
    return NextResponse.json({ success: true, models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}

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
  guardrails: z.record(z.unknown()).optional(),
  operational: z.record(z.unknown()).optional(),
  performancePriors: z.array(z.record(z.unknown())).optional(),
  governance: z.record(z.unknown()).optional(),
  evaluationMeta: z.record(z.unknown()).optional(),
});

/** POST: upsert model (add or update) */
export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    if (raw == null || typeof raw !== "object") {
      return err400("VALIDATION_ERROR", "Request body must be a JSON object");
    }
    const parsed = UpsertBodySchema.safeParse(raw);
    if (!parsed.success) {
      return err400(
        "VALIDATION_ERROR",
        parsed.error.message,
        parsed.error.issues
      );
    }
    const data = parsed.data;
    const existing = await getModel(data.id);
    const killSwitchNow = (data.governance as { killSwitch?: boolean } | undefined)?.killSwitch === true;
    const killSwitchWas = (existing?.governance as { killSwitch?: boolean } | undefined)?.killSwitch === true;
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
    const entry = {
      ...data,
      createdAtISO: now,
      updatedAtISO: now,
    };
    const saved = await upsertModel(entry);
    return NextResponse.json({ success: true, model: saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
