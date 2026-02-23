import { NextResponse } from "next/server";
import { getAllRecords, getAllComputed } from "../../../../src/calibration/store";

export async function GET() {
  try {
    const [records, computed] = await Promise.all([
      getAllRecords(),
      getAllComputed(),
    ]);
    return NextResponse.json({ records, computed });
  } catch (err) {
    console.error("API /api/stats/calibration error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
