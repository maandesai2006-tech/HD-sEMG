import { NextRequest, NextResponse } from "next/server";
import { listHotels, parseTripAdvisorRef } from "@/lib/xotelo";

// Two modes:
//   ?ref=<TripAdvisor URL or key>  → parse it; if it names a hotel, echo it
//                                    back, and list neighbors in its location
//   ?locationKey=g123&offset=0     → page through hotels in a location
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  const locationKeyParam = req.nextUrl.searchParams.get("locationKey")?.trim();
  const offset = Number(req.nextUrl.searchParams.get("offset")) || 0;

  let locationKey = locationKeyParam ?? null;
  let pastedHotel: { hotelKey: string; name: string | null } | null = null;

  if (ref) {
    const parsed = parseTripAdvisorRef(ref);
    if (!parsed.locationKey) {
      return NextResponse.json(
        {
          error:
            "Couldn't find a TripAdvisor id in that link. Paste a hotel page URL like …/Hotel_Review-g187147-d197685-Reviews-….html",
        },
        { status: 400 }
      );
    }
    locationKey = parsed.locationKey;
    if (parsed.hotelKey) {
      pastedHotel = { hotelKey: parsed.hotelKey, name: parsed.name };
    }
  }
  if (!locationKey) {
    return NextResponse.json({ error: "ref or locationKey required" }, { status: 400 });
  }

  try {
    const hotels = await listHotels(locationKey, offset, 30);
    // If the pasted hotel is in the list, use the list's cleaner name.
    if (pastedHotel && !pastedHotel.name) {
      const match = hotels.find((h) => h.hotelKey === pastedHotel!.hotelKey);
      if (match) pastedHotel.name = match.name;
    }
    return NextResponse.json({ locationKey, pastedHotel, hotels });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
