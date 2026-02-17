// ─── app/api/ops/model-hr/registry/[id]/disable/route.ts ────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { disableModel } from "../../../../../../dist/src/lib/model-hr/index.js";

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

const DisableBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
});

/** POST: disable model by id */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return err400("VALIDATION_ERROR", "Model id is required");
    }
    const raw = await request.json();
    const body = raw && typeof raw === "object" ? raw : {};
    const parsed = DisableBodySchema.safeParse(body);
    if (!parsed.success) {
      return err400(
        "VALIDATION_ERROR",
        parsed.error.message,
        parsed.error.issues
      );
    }
    const model = await disableModel(id, parsed.data.reason);
    if (!model) {
      return err404("NOT_FOUND", `Model not found: ${id}`, { modelId: id });
    }
    return NextResponse.json({ success: true, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
