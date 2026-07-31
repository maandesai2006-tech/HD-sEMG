"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { GridResponse, GridRow, HistoryPoint, Hotel } from "@/lib/types";
import Sparkline from "@/components/Sparkline";

type GridPayload = (GridResponse & { configured: true }) | { configured: false };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function binOf(price: number | null, mkt: number | null): string {
  if (price == null || mkt == null || mkt === 0) return "bin-na";
  const pct = ((price - mkt) / mkt) * 100;
  if (pct <= -15) return "bin--2";
  if (pct <= -5) return "bin--1";
  if (pct < 5) return "bin-0";
  if (pct < 15) return "bin-1";
  return "bin-2";
}

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface TooltipState {
  x: number;
  y: number;
  lines: string[];
}

export default function Dashboard() {
  const [data, setData] = useState<GridPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [drawerDate, setDrawerDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/grid");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Failed to load (${res.status})`);
      setData(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Refresh failed");
      setRefreshMsg(
        j.errors?.length
          ? `Fetched with ${j.errors.length} error(s): ${j.errors[0]}`
          : `Fetched ${j.rowsWritten} rates.`
      );
      await load();
    } catch (e) {
      setRefreshMsg(`Refresh failed: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function saveMyRate(date: string) {
    const price = editValue.trim() === "" ? null : Number(editValue);
    if (price != null && (Number.isNaN(price) || price < 0)) return;
    setEditingDate(null);
    await fetch("/api/my-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkIn: date, price }),
    });
    await load();
  }

  const fmt = useMemo(() => {
    const currency =
      data && data.configured ? data.settings.currency : "USD";
    const f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    return (n: number) => f.format(n);
  }, [data]);

  if (error) {
    return (
      <Shell>
        <div
          className="mt-10 rounded-xl border p-6"
          style={{ borderColor: "var(--status-critical)", background: "var(--surface)" }}
        >
          <h2 className="font-semibold">Something went wrong</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {error}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            If this is a fresh deploy, check that the Supabase environment
            variables are set and that the database migration ran.
          </p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <p className="mt-10 text-sm" style={{ color: "var(--text-muted)" }}>
          Loading…
        </p>
      </Shell>
    );
  }

  if (!data.configured) {
    return (
      <Shell>
        <div
          className="mt-10 rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="text-lg font-semibold">Welcome to Rate Beacon</h2>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
            Track what nearby hotels charge night by night, spot high-demand
            dates, and see where your own rate sits against the market.
          </p>
          <Link
            href="/setup"
            className="mt-5 inline-block rounded-lg px-5 py-2.5 font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Set up your market →
          </Link>
        </div>
      </Shell>
    );
  }

  const { settings, hotels, rows, weekdayAvg, lastCapturedAt } = data;
  const myHotel = hotels.find((h) => h.is_mine) ?? null;
  const comps = hotels.filter((h) => !h.is_mine);
  const hasAnyData = rows.some((r) => r.compCount > 0 || r.soldOutCount > 0);

  const next30 = rows.slice(0, 30);
  const stats = {
    raise: rows.filter((r) => r.advice === "raise").length,
    low: rows.filter((r) => r.advice === "review_low").length,
    high: rows.filter((r) => r.advice === "review_high").length,
    hot: rows.filter((r) => (r.demand ?? 0) >= 40).length,
    avg30: (() => {
      const m = next30.filter((r) => r.median != null).map((r) => r.median as number);
      return m.length ? m.reduce((a, b) => a + b, 0) / m.length : null;
    })(),
  };
  const maxWeekday = Math.max(
    1,
    ...weekdayAvg.map((w) => w.avgMedian ?? 0)
  );

  const drawerRow = drawerDate ? rows.find((r) => r.date === drawerDate) ?? null : null;

  return (
    <Shell
      header={
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">
              {settings.hotel_name || "Rate Beacon"}
            </h1>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {settings.city_name ?? settings.city_code} · {comps.length} competitor
              {comps.length === 1 ? "" : "s"} ·{" "}
              {lastCapturedAt
                ? `rates updated ${new Date(lastCapturedAt).toLocaleString()}`
                : "no rates fetched yet"}
            </p>
          </div>
          <Link
            href="/setup"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--baseline)" }}
          >
            Edit market
          </Link>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {refreshing ? "Fetching rates… (can take a minute)" : "Refresh rates"}
          </button>
        </div>
      }
    >
      {refreshMsg && (
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          {refreshMsg}
        </p>
      )}

      {!hasAnyData && (
        <div
          className="mt-6 rounded-xl border p-5 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          No rates in the database yet — hit <b>Refresh rates</b> to fetch live
          prices for the next {settings.horizon_days} days. After the first
          fetch, a daily job keeps this up to date automatically.
        </div>
      )}

      {/* Stat tiles */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          value={String(stats.raise)}
          label="nights with room to raise"
          tone={stats.raise > 0 ? "var(--delta-good-text)" : undefined}
        />
        <StatTile value={String(stats.hot)} label="high-demand nights ahead" />
        <StatTile
          value={String(stats.high)}
          label="nights priced above a soft market"
          tone={stats.high > 0 ? "var(--status-critical)" : undefined}
        />
        <StatTile
          value={stats.avg30 != null ? fmt(stats.avg30) : "—"}
          label="avg market rate, next 30 nights"
        />
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="flex h-10 items-end gap-1" aria-label="Typical market rate by weekday">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
              const v = weekdayAvg.find((w) => w.weekday === wd)?.avgMedian ?? null;
              return (
                <div
                  key={wd}
                  className="flex-1 rounded-t"
                  title={v != null ? `${WEEKDAYS[wd]}: ${fmt(v)}` : `${WEEKDAYS[wd]}: no data`}
                  style={{
                    height: v != null ? `${Math.max(8, (v / maxWeekday) * 100)}%` : "4px",
                    background: v != null ? "var(--series-1)" : "var(--gridline)",
                  }}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            typical market rate, Mon → Sun
          </p>
        </div>
      </div>

      {/* Rate grid */}
      <div
        className="mt-6 overflow-x-auto rounded-xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr
              className="sticky top-0 z-10 text-left text-xs"
              style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
            >
              <th className="px-3 py-2 font-medium">Check-in</th>
              <th className="px-3 py-2 font-medium">
                {myHotel ? myHotel.name : "My rate"}{" "}
                <span style={{ color: "var(--text-muted)" }}>(you)</span>
              </th>
              {comps.map((h) => (
                <th key={h.hotel_id} className="max-w-32 truncate px-3 py-2 font-medium" title={h.name}>
                  {h.name}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Market median</th>
              <th className="px-3 py-2 font-medium">Demand</th>
              <th className="px-3 py-2 font-medium">Advice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <GridRowView
                key={r.date}
                row={r}
                comps={comps}
                fmt={fmt}
                editing={editingDate === r.date}
                editValue={editValue}
                onStartEdit={() => {
                  setEditingDate(r.date);
                  setEditValue(r.myPrice != null ? String(r.myPrice) : "");
                }}
                onEditChange={setEditValue}
                onEditSave={() => saveMyRate(r.date)}
                onEditCancel={() => setEditingDate(null)}
                onOpen={() => setDrawerDate(r.date)}
                onTooltip={setTooltip}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Color legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span>Cell color = price vs that night&apos;s market median:</span>
        {[
          ["bin--2", "≤ −15%"],
          ["bin--1", "−15…−5%"],
          ["bin-0", "±5%"],
          ["bin-1", "+5…15%"],
          ["bin-2", "≥ +15%"],
        ].map(([cls, label]) => (
          <span key={cls} className="inline-flex items-center gap-1">
            <span
              className={`${cls} inline-block h-3.5 w-3.5 rounded border`}
              style={{ borderColor: "var(--border)" }}
            />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span style={{ color: "var(--text-muted)" }}>sold out</span> = no rate
          returned
        </span>
      </div>

      {/* Tooltip layer */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 max-w-72 rounded-lg border px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(tooltip.x + 14, typeof window !== "undefined" ? window.innerWidth - 300 : tooltip.x),
            top: tooltip.y + 14,
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          {tooltip.lines.map((l, i) => (
            <div key={i} style={i > 0 ? { color: "var(--text-secondary)" } : undefined}>
              {l}
            </div>
          ))}
        </div>
      )}

      {/* History drawer */}
      {drawerRow && (
        <HistoryDrawer
          row={drawerRow}
          hotels={hotels}
          fmt={fmt}
          onClose={() => setDrawerDate(null)}
        />
      )}
    </Shell>
  );
}

function Shell({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-screen-2xl p-4 sm:p-6">
      {header ?? (
        <h1 className="text-xl font-semibold">Rate Beacon</h1>
      )}
      {children}
    </main>
  );
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="text-2xl font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
    </div>
  );
}

const ADVICE_META: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  raise: { label: "Raise", icon: "▲", color: "var(--delta-good-text)" },
  review_low: { label: "Low?", icon: "▲", color: "var(--status-warning)" },
  review_high: { label: "High", icon: "▼", color: "var(--status-critical)" },
  in_line: { label: "OK", icon: "•", color: "var(--text-muted)" },
};

function GridRowView({
  row,
  comps,
  fmt,
  editing,
  editValue,
  onStartEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onOpen,
  onTooltip,
}: {
  row: GridRow;
  comps: Hotel[];
  fmt: (n: number) => string;
  editing: boolean;
  editValue: string;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onOpen: () => void;
  onTooltip: (t: TooltipState | null) => void;
}) {
  const weekend = [5, 6].includes(new Date(`${row.date}T00:00:00Z`).getUTCDay());
  const advice = row.advice ? ADVICE_META[row.advice] : null;

  function cellTooltip(e: React.MouseEvent, hotel: Hotel) {
    const c = row.cells[hotel.hotel_id];
    const lines = [hotel.name];
    if (c.capturedOn == null) {
      lines.push("No data yet — refresh rates.");
    } else if (!c.available || c.price == null) {
      lines.push("Sold out / no rate returned");
      lines.push(`checked ${c.capturedOn}`);
    } else {
      lines.push(`${fmt(c.price)} per night`);
      if (row.median != null && row.median > 0) {
        const pct = ((c.price - row.median) / row.median) * 100;
        lines.push(`${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs market median`);
      }
      if (c.roomDesc) lines.push(c.roomDesc.slice(0, 90));
      lines.push(`captured ${c.capturedOn}`);
    }
    onTooltip({ x: e.clientX, y: e.clientY, lines });
  }

  return (
    <tr
      className="border-t"
      style={{
        borderColor: "var(--gridline)",
        background: weekend ? "color-mix(in oklab, var(--gridline) 25%, transparent)" : undefined,
      }}
    >
      <td className="whitespace-nowrap px-3 py-1.5">
        <button
          onClick={onOpen}
          className="underline-offset-2 hover:underline"
          title="Open price history"
        >
          {dateLabel(row.date)}
        </button>
      </td>

      {/* My rate (editable) */}
      <td
        className={`${binOf(row.myPrice, row.median)} cursor-pointer px-3 py-1.5 tabular-nums`}
        onClick={() => !editing && onStartEdit()}
        title="Click to set your rate for this night"
      >
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onEditSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditSave();
              if (e.key === "Escape") onEditCancel();
            }}
            className="w-20 rounded border px-1 py-0.5 text-sm"
            style={{ borderColor: "var(--accent)", background: "var(--surface)" }}
            placeholder="price"
          />
        ) : row.myPrice != null ? (
          <>
            {fmt(row.myPrice)}
            {row.myPriceSource === "manual" && (
              <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }} title="Entered manually">
                ✎
              </span>
            )}
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>set…</span>
        )}
      </td>

      {comps.map((h) => {
        const c = row.cells[h.hotel_id];
        const soldOut = c.capturedOn != null && (!c.available || c.price == null);
        return (
          <td
            key={h.hotel_id}
            className={`${soldOut ? "bin-na" : binOf(c.price, row.median)} px-3 py-1.5 tabular-nums`}
            onMouseMove={(e) => cellTooltip(e, h)}
            onMouseLeave={() => onTooltip(null)}
          >
            {c.capturedOn == null ? (
              <span style={{ color: "var(--text-muted)" }}>—</span>
            ) : soldOut ? (
              <span style={{ color: "var(--text-muted)" }}>sold out</span>
            ) : (
              fmt(c.price as number)
            )}
          </td>
        );
      })}

      <td className="px-3 py-1.5 text-right tabular-nums">
        {row.median != null ? fmt(row.median) : <span style={{ color: "var(--text-muted)" }}>—</span>}
      </td>

      {/* Demand 0–100: number + magnitude bar (sequential hue) */}
      <td className="px-3 py-1.5">
        {row.demand != null ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-6 text-right text-xs tabular-nums">{row.demand}</span>
            <span
              className="inline-block h-2 w-14 overflow-hidden rounded"
              style={{ background: "var(--gridline)" }}
              role="img"
              aria-label={`Demand ${row.demand} of 100`}
            >
              <span
                className="block h-full rounded"
                style={{ width: `${row.demand}%`, background: "var(--series-1)" }}
              />
            </span>
            {row.soldOutCount > 0 && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {row.soldOutCount} full
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </td>

      <td className="whitespace-nowrap px-3 py-1.5">
        {advice ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: advice.color }}
            title={
              row.momentumPct != null
                ? `Market moved ${row.momentumPct >= 0 ? "+" : ""}${row.momentumPct.toFixed(0)}% over ~2 weeks`
                : undefined
            }
          >
            <span aria-hidden>{advice.icon}</span> {advice.label}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </td>
    </tr>
  );
}

function HistoryDrawer({
  row,
  hotels,
  fmt,
  onClose,
}: {
  row: GridRow;
  hotels: Hotel[];
  fmt: (n: number) => string;
  onClose: () => void;
}) {
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      hotels.map(async (h) => {
        const res = await fetch(
          `/api/history?hotelId=${encodeURIComponent(h.hotel_id)}&checkIn=${row.date}`
        );
        const j = await res.json();
        return [h.hotel_id, (j.points ?? []) as HistoryPoint[]] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) setHistories(Object.fromEntries(entries));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [row.date, hotels]);

  const sorted = [...hotels].sort((a, b) => {
    if (a.is_mine !== b.is_mine) return a.is_mine ? -1 : 1;
    const pa = row.cells[a.hotel_id]?.price ?? Infinity;
    const pb = row.cells[b.hotel_id]?.price ?? Infinity;
    return pa - pb;
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l p-5 shadow-xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        role="dialog"
        aria-label={`Price history for ${dateLabel(row.date)}`}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{dateLabel(row.date)}</h2>
          <button
            onClick={onClose}
            className="rounded-lg border px-2.5 py-1 text-sm"
            style={{ borderColor: "var(--baseline)" }}
          >
            Close
          </button>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          How each hotel&apos;s rate for this night has moved since tracking began.
          {row.median != null && <> Market median now: <b>{fmt(row.median)}</b>.</>}
        </p>
        {loading ? (
          <p className="mt-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Loading history…
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {sorted.map((h) => {
              const c = row.cells[h.hotel_id];
              return (
                <li
                  key={h.hotel_id}
                  className="rounded-lg border p-3"
                  style={{
                    borderColor: h.is_mine ? "var(--accent)" : "var(--border)",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {h.name}
                      {h.is_mine && (
                        <span className="ml-1.5 text-xs" style={{ color: "var(--accent)" }}>
                          (you)
                        </span>
                      )}
                    </span>
                    <span className="whitespace-nowrap text-sm tabular-nums">
                      {c?.price != null ? (
                        fmt(c.price)
                      ) : c?.capturedOn != null ? (
                        <span style={{ color: "var(--text-muted)" }}>sold out</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>no data</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Sparkline points={histories[h.hotel_id] ?? []} fmt={fmt} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </>
  );
}
