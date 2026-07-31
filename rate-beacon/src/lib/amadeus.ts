// Minimal Amadeus Self-Service API client: OAuth2 token caching, throttled
// requests with retry/backoff (the test environment rate-limits at ~10 tx/s
// and drops connections under load).

const BASE =
  process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET are not set. See .env.example."
    );
  }
  const res = await fetch(`${BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Amadeus auth failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function amadeusGet<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}?${qs}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** attempt);
    try {
      const token = await getToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Amadeus ${res.status} on ${path}`);
        continue;
      }
      if (res.status === 401) {
        cachedToken = null;
        lastErr = new Error("Amadeus token expired");
        continue;
      }
      const json = await res.json();
      if (!res.ok) {
        const detail = json?.errors?.[0]?.detail ?? JSON.stringify(json);
        throw new Error(`Amadeus ${res.status} on ${path}: ${detail}`);
      }
      return json as T;
    } catch (e) {
      // Network-level failure (ECONNRESET etc.) — retry.
      if (e instanceof Error && /Amadeus \d{3} on/.test(e.message)) throw e;
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error(`Amadeus request failed: ${path}`);
}

export interface AmadeusCity {
  iataCode: string;
  name: string;
  countryCode: string | null;
}

export async function searchCities(keyword: string): Promise<AmadeusCity[]> {
  const json = await amadeusGet<{
    data?: {
      iataCode: string;
      name: string;
      address?: { countryCode?: string };
    }[];
  }>("/v1/reference-data/locations", {
    subType: "CITY",
    keyword,
    "page[limit]": "12",
  });
  return (json.data ?? []).map((d) => ({
    iataCode: d.iataCode,
    name: d.name,
    countryCode: d.address?.countryCode ?? null,
  }));
}

export interface AmadeusHotel {
  hotelId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
}

export async function listHotelsByCity(cityCode: string): Promise<AmadeusHotel[]> {
  const json = await amadeusGet<{
    data?: {
      hotelId: string;
      name: string;
      geoCode?: { latitude?: number; longitude?: number };
      distance?: { value?: number; unit?: string };
    }[];
  }>("/v1/reference-data/locations/hotels/by-city", {
    cityCode,
    radius: "30",
    radiusUnit: "KM",
  });
  return (json.data ?? []).map((d) => ({
    hotelId: d.hotelId,
    name: d.name,
    latitude: d.geoCode?.latitude ?? null,
    longitude: d.geoCode?.longitude ?? null,
    distanceKm: d.distance?.value ?? null,
  }));
}

export interface HotelOffer {
  hotelId: string;
  available: boolean;
  price: number | null;
  currency: string | null;
  roomDesc: string | null;
}

// One check-in date, up to ~20 hotel ids per call. Hotels that return no offer
// (sold out, or errored in `warnings`) come back as available=false.
export async function getOffers(
  hotelIds: string[],
  checkIn: string,
  checkOut: string,
  adults: number,
  currency: string
): Promise<HotelOffer[]> {
  const json = await amadeusGet<{
    data?: {
      hotel?: { hotelId?: string };
      available?: boolean;
      offers?: {
        price?: { total?: string; currency?: string };
        room?: { description?: { text?: string } };
      }[];
    }[];
  }>("/v3/shopping/hotel-offers", {
    hotelIds: hotelIds.join(","),
    checkInDate: checkIn,
    checkOutDate: checkOut,
    adults: String(adults),
    roomQuantity: "1",
    currency,
    bestRateOnly: "true",
  });

  const byId = new Map<string, HotelOffer>();
  for (const d of json.data ?? []) {
    const id = d.hotel?.hotelId;
    if (!id) continue;
    const offer = d.offers?.[0];
    const total = offer?.price?.total;
    byId.set(id, {
      hotelId: id,
      available: d.available !== false && total != null,
      price: total != null ? parseFloat(total) : null,
      currency: offer?.price?.currency ?? null,
      roomDesc: offer?.room?.description?.text?.slice(0, 200) ?? null,
    });
  }
  return hotelIds.map(
    (id) =>
      byId.get(id) ?? {
        hotelId: id,
        available: false,
        price: null,
        currency: null,
        roomDesc: null,
      }
  );
}
