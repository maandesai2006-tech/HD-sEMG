// Xotelo (https://xotelo.com) — free, keyless JSON API serving TripAdvisor
// meta-search prices across OTAs (Booking.com, Expedia, Agoda, …).
//
// Identifiers come straight from TripAdvisor URLs:
//   https://www.tripadvisor.com/Hotel_Review-g187147-d197685-Reviews-Hotel_X-Paris.html
//   → location_key "g187147", hotel_key "g187147-d197685"

const BASE = "https://data.xotelo.com/api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function xoteloGet<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(700 * 2 ** attempt);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Xotelo ${res.status} on ${path}`);
        continue;
      }
      const json = (await res.json()) as {
        error: { message?: string } | string | null;
        result: T | null;
      };
      if (json.error) {
        const msg =
          typeof json.error === "string"
            ? json.error
            : json.error.message ?? JSON.stringify(json.error);
        throw new XoteloApiError(msg);
      }
      return (json.result ?? ({} as T)) as T;
    } catch (e) {
      if (e instanceof XoteloApiError) throw e;
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error(`Xotelo request failed: ${path}`);
}

// API-level errors (e.g. "no availability", bad key) — not worth retrying.
export class XoteloApiError extends Error {}

export interface ParsedTripAdvisorUrl {
  locationKey: string | null;
  hotelKey: string | null;
  name: string | null;
}

// Accepts a full TripAdvisor URL (any country domain), a bare hotel key
// ("g187147-d197685"), or a bare location key ("g187147").
export function parseTripAdvisorRef(input: string): ParsedTripAdvisorUrl {
  const s = input.trim();
  const bare = s.match(/^(g\d+)(?:-(d\d+))?$/i);
  if (bare) {
    return {
      locationKey: bare[1].toLowerCase(),
      hotelKey: bare[2] ? `${bare[1]}-${bare[2]}`.toLowerCase() : null,
      name: null,
    };
  }
  const g = s.match(/[-/](g\d+)/i);
  const d = s.match(/-(d\d+)/i);
  // Hotel_Review-g187147-d197685-Reviews-Hotel_Name-City.html → "Hotel Name"
  const nameMatch = s.match(/Reviews-([^-][^/]*?)-[^-/]+\.html/i);
  const name = nameMatch
    ? decodeURIComponent(nameMatch[1]).replace(/_/g, " ").trim()
    : null;
  return {
    locationKey: g ? g[1].toLowerCase() : null,
    hotelKey: g && d ? `${g[1]}-${d[1]}`.toLowerCase() : null,
    name,
  };
}

export interface XoteloRates {
  price: number | null; // cheapest OTA total for the stay
  currency: string | null;
  otaName: string | null; // which OTA had the cheapest rate
  offerCount: number;
  available: boolean;
}

interface RatesResult {
  chk_in?: string;
  chk_out?: string;
  currency?: string;
  rates?: { code?: string; name?: string; rate?: number; tax?: number }[];
}

export async function getRates(
  hotelKey: string,
  checkIn: string,
  checkOut: string,
  currency: string,
  adults: number
): Promise<XoteloRates> {
  try {
    const result = await xoteloGet<RatesResult>("/rates", {
      hotel_key: hotelKey,
      chk_in: checkIn,
      chk_out: checkOut,
      currency,
      adults: String(adults),
      rooms: "1",
    });
    const offers = (result.rates ?? []).filter(
      (r) => typeof r.rate === "number" && r.rate! > 0
    );
    if (offers.length === 0) {
      return { price: null, currency: null, otaName: null, offerCount: 0, available: false };
    }
    const cheapest = offers.reduce((a, b) =>
      (a.rate! + (a.tax ?? 0)) <= (b.rate! + (b.tax ?? 0)) ? a : b
    );
    return {
      price: cheapest.rate! + (cheapest.tax ?? 0),
      currency: result.currency ?? currency,
      otaName: cheapest.name ?? cheapest.code ?? null,
      offerCount: offers.length,
      available: true,
    };
  } catch (e) {
    if (e instanceof XoteloApiError) {
      // "No availability" style errors mean sold out / not bookable that night.
      return { price: null, currency: null, otaName: null, offerCount: 0, available: false };
    }
    throw e;
  }
}

export interface XoteloHotel {
  hotelKey: string;
  name: string;
}

interface ListResult {
  list?: {
    key?: string;
    hotel_key?: string;
    name?: string;
    title?: string;
  }[];
  total_count?: number;
}

// Hotels in a TripAdvisor location, for the competitor picker.
export async function listHotels(
  locationKey: string,
  offset = 0,
  limit = 30
): Promise<XoteloHotel[]> {
  const result = await xoteloGet<ListResult>("/list", {
    location_key: locationKey,
    offset: String(offset),
    limit: String(limit),
  });
  return (result.list ?? [])
    .map((h) => ({
      hotelKey: (h.key ?? h.hotel_key ?? "").toLowerCase(),
      name: h.name ?? h.title ?? "",
    }))
    .filter((h) => /^g\d+-d\d+$/.test(h.hotelKey) && h.name);
}
