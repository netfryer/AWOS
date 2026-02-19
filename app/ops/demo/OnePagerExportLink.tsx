// ─── app/ops/demo/OnePagerExportLink.tsx ─────────────────────────────────────
// Link to printable one-pager view.

"use client";

import Link from "next/link";
import { demoStyles } from "./demoStyles";

export interface OnePagerExportLinkProps {
  runSessionId: string | null;
}

export function OnePagerExportLink({ runSessionId }: OnePagerExportLinkProps) {
  if (!runSessionId) return null;

  return (
    <Link
      href={`/ops/demo/runs/${runSessionId}/one-pager`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        ...demoStyles.btnSecondary,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      Export one-pager
    </Link>
  );
}
