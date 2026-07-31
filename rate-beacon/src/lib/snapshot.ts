import { db } from "./db";
import { getRates } from "./xotelo";
import { addDaysISO, dateRange, todayISO } from "./dates";
import type { Hotel, Settings } from "./types";

export interface SnapshotResult {
  dates: number;
  hotels: number;
  rowsWritten: number;
  errors: string[];
}

// Fetch one-night rates for every tracked hotel over the horizon and store
// today's snapshot. Called by the daily cron and the manual refresh button.
// Xotelo is one request per hotel per night, so run a small worker pool and
// let `maxDates` cap the horizon to stay inside serverless time limits.
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
  const errors: string[] = [];
  let rowsWritten = 0;

  const jobs = dates.flatMap((checkIn) =>
    hotels.map((h) => ({ checkIn, hotel: h }))
  );

  const CONCURRENCY = 4;
  let cursor = 0;
  let aborted = false;

  async function worker() {
    while (!aborted) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const { checkIn, hotel } = jobs[i];
      try {
        const r = await getRates(
          hotel.hotel_id,
          checkIn,
          addDaysISO(checkIn, 1),
          settings!.currency,
          settings!.adults
        );
        const { error } = await supa.from("rate_snapshots").upsert(
          {
            hotel_id: hotel.hotel_id,
            check_in: checkIn,
            captured_on: todayISO(),
            price: r.price,
            currency: r.currency ?? settings!.currency,
            available: r.available,
            room_desc: r.otaName
              ? `${r.otaName} · cheapest of ${r.offerCount} OTA offer${r.offerCount === 1 ? "" : "s"}`
              : null,
          },
          { onConflict: "hotel_id,check_in,captured_on" }
        );
        if (error) errors.push(`${hotel.name} ${checkIn}: ${error.message}`);
        else rowsWritten++;
      } catch (e) {
        errors.push(`${hotel.name} ${checkIn}: ${(e as Error).message}`);
        // Persistent failure (network, upstream outage) — stop hammering.
        if (errors.length >= 10) aborted = true;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return {
    dates: dates.length,
    hotels: hotels.length,
    rowsWritten,
    errors: errors.slice(0, 10),
  };
}
