import { db } from "./db";
import { getOffers } from "./amadeus";
import { addDaysISO, dateRange, todayISO } from "./dates";
import type { Hotel, Settings } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface SnapshotResult {
  dates: number;
  hotels: number;
  rowsWritten: number;
  errors: string[];
}

// Fetch one-night rates for every tracked hotel over the horizon and store
// today's snapshot. Called by the daily cron and the manual refresh button.
// `maxDates` lets callers stay inside serverless time limits.
export async function runSnapshot(maxDates?: number): Promise<SnapshotResult> {
  const supa = db();

  const [{ data: settings }, { data: hotels }] = await Promise.all([
    supa.from("settings").select("*").eq("id", 1).maybeSingle<Settings>(),
    supa.from("hotels").select("*").returns<Hotel[]>(),
  ]);
  if (!settings || !hotels || hotels.length === 0) {
    return { dates: 0, hotels: 0, rowsWritten: 0, errors: ["Not configured yet"] };
  }

  const horizon = Math.min(settings.horizon_days, maxDates ?? settings.horizon_days);
  const dates = dateRange(todayISO(), horizon);
  const hotelIds = hotels.map((h) => h.hotel_id);
  const errors: string[] = [];
  let rowsWritten = 0;

  for (const checkIn of dates) {
    const checkOut = addDaysISO(checkIn, 1);
    for (const ids of chunk(hotelIds, 20)) {
      try {
        const offers = await getOffers(
          ids,
          checkIn,
          checkOut,
          settings.adults,
          settings.currency
        );
        const rows = offers.map((o) => ({
          hotel_id: o.hotelId,
          check_in: checkIn,
          captured_on: todayISO(),
          price: o.price,
          currency: o.currency ?? settings.currency,
          available: o.available,
          room_desc: o.roomDesc,
        }));
        const { error } = await supa
          .from("rate_snapshots")
          .upsert(rows, { onConflict: "hotel_id,check_in,captured_on" });
        if (error) errors.push(`${checkIn}: ${error.message}`);
        else rowsWritten += rows.length;
      } catch (e) {
        errors.push(`${checkIn}: ${(e as Error).message}`);
        if (errors.length >= 5) {
          // Persistent failure (bad keys, quota exhausted) — stop burning quota.
          return { dates: dates.length, hotels: hotelIds.length, rowsWritten, errors };
        }
      }
      // Stay well under the test environment's rate limit.
      await sleep(150);
    }
  }
  return { dates: dates.length, hotels: hotelIds.length, rowsWritten, errors };
}
