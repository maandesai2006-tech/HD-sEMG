import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addDaysISO, dateRange, todayISO, weekdayOf } from "@/lib/dates";
import { adviceFor, demandScore, median, positionOf } from "@/lib/insights";
import type {
  GridResponse,
  GridRow,
  Hotel,
  RateCell,
  Settings,
} from "@/lib/types";

export const dynamic = "force-dynamic";

interface SnapshotRow {
  hotel_id: string;
  check_in: string;
  captured_on: string;
  price: number | null;
  available: boolean;
  room_desc: string | null;
  captured_at?: string;
}

export async function GET() {
  const supa = db();
  const today = todayISO();

  const [{ data: settings }, { data: hotels }] = await Promise.all([
    supa.from("settings").select("*").eq("id", 1).maybeSingle<Settings>(),
    supa.from("hotels").select("*").returns<Hotel[]>(),
  ]);
  if (!settings || !hotels || hotels.length === 0) {
    return NextResponse.json({ configured: false });
  }

  const horizonEnd = addDaysISO(today, settings.horizon_days);
  const [latestRes, histRes, myRatesRes, lastCapRes] = await Promise.all([
    supa
      .from("latest_rates")
      .select("*")
      .gte("check_in", today)
      .lt("check_in", horizonEnd)
      .returns<SnapshotRow[]>(),
    // Recent history for momentum: snapshots captured in the last 14 days.
    supa
      .from("rate_snapshots")
      .select("hotel_id, check_in, captured_on, price, available, room_desc")
      .gte("check_in", today)
      .lt("check_in", horizonEnd)
      .gte("captured_on", addDaysISO(today, -14))
      .returns<SnapshotRow[]>(),
    supa.from("my_rates").select("*").gte("check_in", today).lt("check_in", horizonEnd),
    supa
      .from("rate_snapshots")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1),
  ]);

  const latest = latestRes.data ?? [];
  const hist = histRes.data ?? [];
  const myManual = new Map(
    (myRatesRes.data ?? []).map((r: { check_in: string; price: number | null }) => [
      r.check_in,
      r.price,
    ])
  );

  const latestByKey = new Map<string, SnapshotRow>();
  for (const r of latest) latestByKey.set(`${r.hotel_id}|${r.check_in}`, r);

  // Oldest capture within the window per (hotel, date) for momentum.
  const oldestByKey = new Map<string, SnapshotRow>();
  for (const r of hist) {
    const k = `${r.hotel_id}|${r.check_in}`;
    const prev = oldestByKey.get(k);
    if (!prev || r.captured_on < prev.captured_on) oldestByKey.set(k, r);
  }

  const myHotel = hotels.find((h) => h.is_mine) ?? null;
  const comps = hotels.filter((h) => !h.is_mine);

  const rows: GridRow[] = dateRange(today, settings.horizon_days).map((date) => {
    const cells: Record<string, RateCell> = {};
    for (const h of hotels) {
      const s = latestByKey.get(`${h.hotel_id}|${date}`);
      cells[h.hotel_id] = {
        price: s?.price ?? null,
        available: s ? s.available : true,
        roomDesc: s?.room_desc ?? null,
        capturedOn: s?.captured_on ?? null,
      };
    }

    const compPrices = comps
      .map((h) => cells[h.hotel_id])
      .filter((c) => c.available && c.price != null)
      .map((c) => c.price as number);
    const soldOutCount = comps.filter((h) => {
      const c = cells[h.hotel_id];
      return c.capturedOn != null && !c.available;
    }).length;

    const mkt = median(compPrices);

    // Momentum: market median now vs the oldest snapshot in the 14-day window.
    const oldPrices = comps
      .map((h) => oldestByKey.get(`${h.hotel_id}|${date}`))
      .filter(
        (s): s is SnapshotRow =>
          s != null && s.available && s.price != null &&
          s.captured_on < (latestByKey.get(`${s.hotel_id}|${date}`)?.captured_on ?? "")
      )
      .map((s) => s.price as number);
    const oldMkt = median(oldPrices);
    const momentumPct =
      mkt != null && oldMkt != null && oldMkt > 0
        ? ((mkt - oldMkt) / oldMkt) * 100
        : null;

    const manual = myManual.get(date) ?? null;
    const scraped =
      myHotel && cells[myHotel.hotel_id]?.available
        ? cells[myHotel.hotel_id].price
        : null;
    const myPrice = manual ?? scraped;
    const myPriceSource = manual != null ? "manual" : scraped != null ? "amadeus" : null;

    const demand = demandScore(soldOutCount, comps.length, momentumPct);
    const position = positionOf(myPrice, mkt);

    return {
      date,
      cells,
      myPrice,
      myPriceSource,
      median: mkt,
      min: compPrices.length ? Math.min(...compPrices) : null,
      max: compPrices.length ? Math.max(...compPrices) : null,
      compCount: compPrices.length,
      soldOutCount,
      demand,
      momentumPct,
      position,
      advice: adviceFor(position, demand),
    };
  });

  const weekdayAvg = Array.from({ length: 7 }, (_, weekday) => {
    const meds = rows
      .filter((r) => weekdayOf(r.date) === weekday && r.median != null)
      .map((r) => r.median as number);
    return { weekday, avgMedian: meds.length ? median(meds) : null };
  });

  const payload: GridResponse & { configured: boolean } = {
    configured: true,
    settings,
    hotels,
    rows,
    weekdayAvg,
    lastCapturedAt: lastCapRes.data?.[0]?.captured_at ?? null,
  };
  return NextResponse.json(payload);
}
