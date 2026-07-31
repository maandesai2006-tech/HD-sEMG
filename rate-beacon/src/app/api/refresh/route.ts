import { NextRequest, NextResponse } from "next/server";
import { runSnapshot } from "@/lib/snapshot";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const maxDates = Number(req.nextUrl.searchParams.get("maxDates")) || undefined;
  try {
    const result = await runSnapshot(maxDates);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
