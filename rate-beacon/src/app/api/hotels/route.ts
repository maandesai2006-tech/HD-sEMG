import { NextRequest, NextResponse } from "next/server";
import { listHotelsByCity } from "@/lib/amadeus";

export async function GET(req: NextRequest) {
  const cityCode = req.nextUrl.searchParams.get("cityCode")?.trim();
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (!cityCode) {
    return NextResponse.json({ error: "cityCode required" }, { status: 400 });
  }
  try {
    let hotels = await listHotelsByCity(cityCode);
    if (q) hotels = hotels.filter((h) => h.name.toLowerCase().includes(q));
    hotels.sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
    return NextResponse.json({ hotels: hotels.slice(0, 60) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
