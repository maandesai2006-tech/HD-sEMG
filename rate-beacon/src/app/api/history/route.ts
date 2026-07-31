import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { HistoryPoint } from "@/lib/types";

export async function GET(req: NextRequest) {
  const hotelId = req.nextUrl.searchParams.get("hotelId");
  const checkIn = req.nextUrl.searchParams.get("checkIn");
  if (!hotelId || !checkIn) {
    return NextResponse.json({ error: "hotelId and checkIn required" }, { status: 400 });
  }
  const { data, error } = await db()
    .from("rate_snapshots")
    .select("captured_on, price, available")
    .eq("hotel_id", hotelId)
    .eq("check_in", checkIn)
    .order("captured_on", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const points: HistoryPoint[] = (data ?? []).map((r) => ({
    capturedOn: r.captured_on,
    price: r.price,
    available: r.available,
  }));
  return NextResponse.json({ points });
}
