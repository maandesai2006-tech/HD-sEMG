"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface FoundHotel {
  hotelKey: string;
  name: string;
}
interface Picked extends FoundHotel {
  isMine: boolean;
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "AED", "JPY"];

export default function SetupPage() {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [locationKey, setLocationKey] = useState<string | null>(null);
  const [found, setFound] = useState<FoundHotel[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [addUrl, setAddUrl] = useState("");
  const [hotelName, setHotelName] = useState("");
  const [marketName, setMarketName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [horizonDays, setHorizonDays] = useState(45);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prefill when editing an existing setup.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((j) => {
        if (j.settings) {
          setHotelName(j.settings.hotel_name ?? "");
          setMarketName(j.settings.city_name ?? "");
          setCurrency(j.settings.currency ?? "USD");
          setHorizonDays(j.settings.horizon_days ?? 45);
          if (j.settings.city_code) setLocationKey(j.settings.city_code);
        }
        if (j.hotels?.length) {
          setPicked(
            j.hotels.map(
              (h: { hotel_id: string; name: string; is_mine: boolean }) => ({
                hotelKey: h.hotel_id,
                name: h.name,
                isMine: h.is_mine,
              })
            )
          );
        }
      })
      .catch(() => {});
  }, []);

  async function lookup(input: string, nextOffset = 0, append = false) {
    setLoading(true);
    setError(null);
    try {
      const params = append
        ? `locationKey=${locationKey}&offset=${nextOffset}`
        : `ref=${encodeURIComponent(input)}`;
      const res = await fetch(`/api/hotels?${params}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Lookup failed");
      setLocationKey(j.locationKey);
      setFound(append ? [...found, ...j.hotels] : j.hotels);
      setOffset(nextOffset + (j.hotels?.length ?? 0));
      setHasMore((j.hotels?.length ?? 0) >= 30);
      // A pasted hotel page → auto-add it (as "mine" if nothing is yet).
      if (!append && j.pastedHotel) {
        const p = j.pastedHotel as { hotelKey: string; name: string | null };
        setPicked((prev) => {
          if (prev.some((x) => x.hotelKey === p.hotelKey)) return prev;
          const mineExists = prev.some((x) => x.isMine);
          return [
            ...prev,
            {
              hotelKey: p.hotelKey,
              name: p.name ?? p.hotelKey,
              isMine: !mineExists,
            },
          ];
        });
        if (p.name && !hotelName) setHotelName(p.name);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function addByUrl() {
    if (!addUrl.trim()) return;
    fetch(`/api/hotels?ref=${encodeURIComponent(addUrl)}`)
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Couldn't parse that link");
        const p = j.pastedHotel as { hotelKey: string; name: string | null } | null;
        if (!p) throw new Error("That link is a location, not a specific hotel page.");
        setPicked((prev) =>
          prev.some((x) => x.hotelKey === p.hotelKey)
            ? prev
            : [...prev, { hotelKey: p.hotelKey, name: p.name ?? p.hotelKey, isMine: false }]
        );
        setAddUrl("");
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }

  function togglePick(h: FoundHotel) {
    setPicked((p) =>
      p.some((x) => x.hotelKey === h.hotelKey)
        ? p.filter((x) => x.hotelKey !== h.hotelKey)
        : [...p, { ...h, isMine: false }]
    );
  }

  function setMine(hotelKey: string) {
    setPicked((p) =>
      p.map((x) => ({ ...x, isMine: x.hotelKey === hotelKey ? !x.isMine : false }))
    );
  }

  async function save() {
    if (!locationKey) return setError("Paste a TripAdvisor link first.");
    if (picked.length === 0) return setError("Add at least one hotel to track.");
    setSaving(true);
    setError(null);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotelName,
        cityCode: locationKey,
        cityName: marketName,
        currency,
        horizonDays,
        adults: 2,
        hotels: picked.map((h) => ({
          hotelId: h.hotelKey,
          name: h.name,
          isMine: h.isMine,
          latitude: null,
          longitude: null,
        })),
      }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) return setError(j.error ?? "Save failed");
    router.push("/");
  }

  const inputStyle = {
    borderColor: "var(--baseline)",
    background: "var(--surface)",
  } as const;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Set up your market</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        Rates come from TripAdvisor&apos;s public meta-search (via the free Xotelo
        API), so every hotel is identified by its TripAdvisor page.
      </p>

      {/* Step 1: paste link */}
      <section className="mt-8">
        <h2 className="font-medium">1 · Your hotel</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          Find your hotel on tripadvisor.com and paste the page link — e.g.
          …/Hotel_Review-g187147-d197685-Reviews-… (a city page link works too).
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup(ref)}
            placeholder="Paste a TripAdvisor hotel or city link"
            className="w-full rounded-lg border px-3 py-2"
            style={inputStyle}
          />
          <button
            onClick={() => lookup(ref)}
            disabled={loading || !ref.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {loading ? "Looking…" : "Look up"}
          </button>
        </div>
        {locationKey && (
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Market location: <code>{locationKey}</code>
          </p>
        )}
      </section>

      {/* Step 2: tracked hotels */}
      <section className="mt-8">
        <h2 className="font-medium">2 · Hotels to track</h2>

        {picked.length > 0 && (
          <div className="mt-2">
            <h3 className="text-sm font-medium">
              Tracking {picked.length} hotel{picked.length > 1 ? "s" : ""}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Tick &ldquo;mine&rdquo; on your own hotel so the dashboard compares
              you against the rest. Leave it unticked everywhere if your hotel
              isn&apos;t on TripAdvisor — you can type your rates into the grid.
            </p>
            <ul className="mt-2 space-y-1">
              {picked.map((h) => (
                <li
                  key={h.hotelKey}
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
                        onChange={() => setMine(h.hotelKey)}
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

        <div className="mt-3 flex gap-2">
          <input
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addByUrl()}
            placeholder="Add a competitor by pasting its TripAdvisor link"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            onClick={addByUrl}
            className="rounded-lg border px-4 py-2 text-sm"
            style={{ borderColor: "var(--baseline)" }}
          >
            Add
          </button>
        </div>

        {found.length > 0 && (
          <>
            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              Or pick from hotels in this location:
            </p>
            <ul
              className="mt-1 max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2"
              style={{ borderColor: "var(--border)" }}
            >
              {found
                .filter((h) => !picked.some((p) => p.hotelKey === h.hotelKey))
                .map((h) => (
                  <li key={h.hotelKey}>
                    <button
                      onClick={() => togglePick(h)}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:opacity-70"
                    >
                      <span>{h.name}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        add +
                      </span>
                    </button>
                  </li>
                ))}
              {hasMore && (
                <li>
                  <button
                    onClick={() => lookup("", offset, true)}
                    disabled={loading}
                    className="w-full rounded px-2 py-1.5 text-center text-xs underline"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {loading ? "Loading…" : "Load more"}
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </section>

      {/* Step 3: options */}
      <section className="mt-8">
        <h2 className="font-medium">3 · Options</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <span style={{ color: "var(--text-secondary)" }}>Market label</span>
            <input
              value={marketName}
              onChange={(e) => setMarketName(e.target.value)}
              placeholder="e.g. Downtown Austin"
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
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Daily data volume = hotels × days ahead (one lookup per hotel per
          night). 6 hotels × 45 days ≈ 270 polite requests once a day.
        </p>
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
