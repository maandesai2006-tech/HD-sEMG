"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface City {
  iataCode: string;
  name: string;
  countryCode: string | null;
}
interface FoundHotel {
  hotelId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
}
interface Picked extends FoundHotel {
  isMine: boolean;
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "AED", "JPY"];

export default function SetupPage() {
  const router = useRouter();
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [hotelQuery, setHotelQuery] = useState("");
  const [found, setFound] = useState<FoundHotel[]>([]);
  const [loadingHotels, setLoadingHotels] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [hotelName, setHotelName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [horizonDays, setHorizonDays] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prefill when editing an existing setup.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((j) => {
        if (j.settings) {
          setHotelName(j.settings.hotel_name ?? "");
          setCurrency(j.settings.currency ?? "USD");
          setHorizonDays(j.settings.horizon_days ?? 60);
          if (j.settings.city_code) {
            setCity({
              iataCode: j.settings.city_code,
              name: j.settings.city_name ?? j.settings.city_code,
              countryCode: null,
            });
          }
        }
        if (j.hotels?.length) {
          setPicked(
            j.hotels.map(
              (h: {
                hotel_id: string;
                name: string;
                is_mine: boolean;
                latitude: number | null;
                longitude: number | null;
              }) => ({
                hotelId: h.hotel_id,
                name: h.name,
                isMine: h.is_mine,
                latitude: h.latitude,
                longitude: h.longitude,
                distanceKm: null,
              })
            )
          );
        }
      })
      .catch(() => {});
  }, []);

  function searchCities(q: string) {
    setCityQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setCities([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`);
      const j = await res.json();
      if (res.ok) setCities(j.cities ?? []);
      else setError(j.error ?? "City search failed");
    }, 400);
  }

  async function loadHotels(c: City, q: string) {
    setLoadingHotels(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/hotels?cityCode=${c.iataCode}&q=${encodeURIComponent(q)}`
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Hotel search failed");
      setFound(j.hotels ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingHotels(false);
    }
  }

  function togglePick(h: FoundHotel) {
    setPicked((p) =>
      p.some((x) => x.hotelId === h.hotelId)
        ? p.filter((x) => x.hotelId !== h.hotelId)
        : [...p, { ...h, isMine: false }]
    );
  }

  function setMine(hotelId: string) {
    setPicked((p) =>
      p.map((x) => ({ ...x, isMine: x.hotelId === hotelId ? !x.isMine : false }))
    );
  }

  async function save() {
    if (!city) return setError("Pick a city first.");
    if (picked.length === 0) return setError("Pick at least one hotel to track.");
    setSaving(true);
    setError(null);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotelName,
        cityCode: city.iataCode,
        cityName: city.name,
        currency,
        horizonDays,
        adults: 2,
        hotels: picked,
      }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) return setError(j.error ?? "Save failed");
    router.push("/?fresh=1");
  }

  const inputStyle = {
    borderColor: "var(--baseline)",
    background: "var(--surface)",
  } as const;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Set up your market</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        Pick your city, mark your own hotel if it&apos;s listed, and choose the
        competitor hotels to track.
      </p>

      {/* Step 1: city */}
      <section className="mt-8">
        <h2 className="font-medium">1 · City</h2>
        {city ? (
          <div className="mt-2 flex items-center gap-3">
            <span
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              {city.name} ({city.iataCode})
            </span>
            <button
              className="text-sm underline"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => {
                setCity(null);
                setFound([]);
              }}
            >
              change
            </button>
          </div>
        ) : (
          <div className="relative mt-2">
            <input
              value={cityQuery}
              onChange={(e) => searchCities(e.target.value)}
              placeholder="Start typing a city… e.g. London"
              className="w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
            {cities.length > 0 && (
              <ul
                className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border shadow-sm"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                {cities.map((c) => (
                  <li key={`${c.iataCode}-${c.name}`}>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:opacity-70"
                      onClick={() => {
                        setCity(c);
                        setCities([]);
                        setCityQuery("");
                        loadHotels(c, "");
                      }}
                    >
                      {c.name}
                      <span style={{ color: "var(--text-muted)" }}>
                        {" "}
                        · {c.iataCode}
                        {c.countryCode ? ` · ${c.countryCode}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Step 2: hotels */}
      {city && (
        <section className="mt-8">
          <h2 className="font-medium">2 · Hotels to track</h2>
          <div className="mt-2 flex gap-2">
            <input
              value={hotelQuery}
              onChange={(e) => setHotelQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadHotels(city, hotelQuery)}
              placeholder="Filter by hotel name (optional)"
              className="w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
            <button
              onClick={() => loadHotels(city, hotelQuery)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--accent)" }}
            >
              Search
            </button>
          </div>

          {loadingHotels && (
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              Loading hotels…
            </p>
          )}

          {picked.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium">
                Tracking {picked.length} hotel{picked.length > 1 ? "s" : ""}
              </h3>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Tick &ldquo;mine&rdquo; on your own hotel (if it&apos;s listed) so the
                dashboard compares you against the rest.
              </p>
              <ul className="mt-2 space-y-1">
                {picked.map((h) => (
                  <li
                    key={h.hotelId}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    style={{
                      borderColor: h.isMine ? "var(--accent)" : "var(--border)",
                      background: "var(--surface)",
                    }}
                  >
                    <span>
                      {h.name}
                      {h.isMine && (
                        <span
                          className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium text-white"
                          style={{ background: "var(--accent)" }}
                        >
                          mine
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={h.isMine}
                          onChange={() => setMine(h.hotelId)}
                        />
                        mine
                      </label>
                      <button
                        onClick={() => togglePick(h)}
                        className="text-xs underline"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {found.length > 0 && (
            <ul
              className="mt-4 max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2"
              style={{ borderColor: "var(--border)" }}
            >
              {found
                .filter((h) => !picked.some((p) => p.hotelId === h.hotelId))
                .map((h) => (
                  <li key={h.hotelId}>
                    <button
                      onClick={() => togglePick(h)}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:opacity-70"
                    >
                      <span>{h.name}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {h.distanceKm != null ? `${h.distanceKm.toFixed(1)} km · ` : ""}
                        add +
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {/* Step 3: options */}
      <section className="mt-8">
        <h2 className="font-medium">3 · Options</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span style={{ color: "var(--text-secondary)" }}>Your hotel name</span>
            <input
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              placeholder="Shown in the header"
              className="mt-1 w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </label>
          <label className="text-sm">
            <span style={{ color: "var(--text-secondary)" }}>Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span style={{ color: "var(--text-secondary)" }}>Days ahead (7–120)</span>
            <input
              type="number"
              min={7}
              max={120}
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </label>
        </div>
      </section>

      {error && (
        <p className="mt-4 text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}

      <div className="mt-8 flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {saving ? "Saving…" : "Save & open dashboard"}
        </button>
        <button
          onClick={() => router.push("/")}
          className="rounded-lg border px-5 py-2.5"
          style={{ borderColor: "var(--baseline)" }}
        >
          Cancel
        </button>
      </div>
    </main>
  );
}
