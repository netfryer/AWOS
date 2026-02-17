// ─── app/api/ops/model-hr/registry/[id]/status/route.ts ──────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setModelStatus } from "../../../../../../dist/src/lib/model-hr/index.js";

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

const StatusBodySchema = z.object({
  status: z.enum(["active", "probation"], {
    errorMap: () => ({ message: "status must be 'active' or 'probation'" }),
  }),
});

/** POST: set model status (graduate -> active, probation -> probation) */
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
    const parsed = StatusBodySchema.safeParse(body);
    if (!parsed.success) {
      return err400(
        "VALIDATION_ERROR",
        parsed.error.message,
        parsed.error.issues
      );
    }
    const model = await setModelStatus(id, parsed.data.status);
    if (!model) {
      return err404("NOT_FOUND", `Model not found: ${id}`, { modelId: id });
    }
    return NextResponse.json({ success: true, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return err500("INTERNAL_ERROR", msg);
  }
}
