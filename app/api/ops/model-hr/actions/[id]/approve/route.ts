// ─── app/api/ops/model-hr/actions/[id]/approve/route.ts ─────────────────────
// POST /api/ops/model-hr/actions/:id/approve { approvedBy: string }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approveAction, getActionById, makeFileRegistryService } from "../../../../../../../src/lib/model-hr/index";

const ApproveBodySchema = z.object({
  approvedBy: z.string().min(1, "approvedBy is required"),
});

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return err400("VALIDATION_ERROR", "Action id is required");
    const raw = await request.json();
    const body = raw && typeof raw === "object" ? raw : {};
    const parsed = ApproveBodySchema.safeParse(body);
    if (!parsed.success) {
      return err400("VALIDATION_ERROR", parsed.error.message, parsed.error.issues);
    }
    const action = await getActionById(id);
    if (!action) return err404("NOT_FOUND", `Action not found: ${id}`, { actionId: id });
    const registry = makeFileRegistryService();
    const result = await approveAction(id, parsed.data.approvedBy, registry);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { code: "APPROVE_FAILED", message: result.error ?? "Approval failed" } },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, action: result.action });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
