import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Hotel, Settings } from "@/lib/types";

export async function GET() {
  const supa = db();
  const [{ data: settings }, { data: hotels }] = await Promise.all([
    supa.from("settings").select("*").eq("id", 1).maybeSingle<Settings>(),
    supa.from("hotels").select("*").order("is_mine", { ascending: false }).returns<Hotel[]>(),
  ]);
  return NextResponse.json({ settings: settings ?? null, hotels: hotels ?? [] });
}

interface SetupBody {
  hotelName: string;
  cityCode: string;
  cityName: string;
  currency: string;
  horizonDays: number;
  adults: number;
  hotels: {
    hotelId: string;
    name: string;
    isMine: boolean;
    latitude: number | null;
    longitude: number | null;
  }[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as SetupBody;
  if (!body.cityCode || !Array.isArray(body.hotels) || body.hotels.length === 0) {
    return NextResponse.json(
      { error: "Pick a city and at least one hotel to track" },
      { status: 400 }
    );
  }
  const supa = db();

  const { error: sErr } = await supa.from("settings").upsert({
    id: 1,
    hotel_name: body.hotelName || null,
    city_code: body.cityCode,
    city_name: body.cityName || null,
    currency: body.currency || "USD",
    horizon_days: Math.min(120, Math.max(7, body.horizonDays || 60)),
    adults: Math.min(9, Math.max(1, body.adults || 2)),
    updated_at: new Date().toISOString(),
  });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const keepIds = body.hotels.map((h) => h.hotelId);
  // Drop hotels no longer tracked (cascades their snapshots).
  const { error: dErr } = await supa
    .from("hotels")
    .delete()
    .not("hotel_id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const { error: hErr } = await supa.from("hotels").upsert(
    body.hotels.map((h) => ({
      hotel_id: h.hotelId,
      name: h.name,
      is_mine: h.isMine,
      city_code: body.cityCode,
      latitude: h.latitude,
      longitude: h.longitude,
    }))
  );
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
