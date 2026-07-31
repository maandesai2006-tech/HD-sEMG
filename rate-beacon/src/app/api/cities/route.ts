import { NextRequest, NextResponse } from "next/server";
import { searchCities } from "@/lib/amadeus";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ cities: [] });
  try {
    return NextResponse.json({ cities: await searchCities(q) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
