"use client";

import { useState } from "react";
import type { HistoryPoint } from "@/lib/types";

// Price-history sparkline: 2px line in the series hue, hover reveals the
// nearest point as a dot with its value labeled in ink (not series color).
export default function Sparkline({
  points,
  fmt,
  width = 180,
  height = 44,
}: {
  points: HistoryPoint[];
  fmt: (n: number) => string;
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const priced = points.filter((p) => p.price != null);
  if (priced.length < 2) {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {priced.length === 1
          ? `${fmt(priced[0].price as number)} · one capture so far`
          : "not enough history yet"}
      </span>
    );
  }
  const pad = 6;
  const prices = priced.map((p) => p.price as number);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const x = (i: number) =>
    pad + (i / (priced.length - 1)) * (width - 2 * pad);
  const y = (v: number) =>
    height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = priced
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price as number).toFixed(1)}`)
    .join(" ");
  const h = hover != null ? priced[hover] : null;

  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Price history, ${priced.length} captures, ${fmt(min)} to ${fmt(max)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const i = Math.round(
            ((px - pad) / (width - 2 * pad)) * (priced.length - 1)
          );
          setHover(Math.max(0, Math.min(priced.length - 1, i)));
        }}
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="var(--baseline)"
          strokeWidth="1"
        />
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="2" />
        {h && (
          <circle
            cx={x(hover as number)}
            cy={y(h.price as number)}
            r="4"
            fill="var(--series-1)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        )}
      </svg>
      <span
        className="w-28 text-xs tabular-nums"
        style={{ color: "var(--text-secondary)" }}
      >
        {h
          ? `${fmt(h.price as number)} · ${h.capturedOn.slice(5)}`
          : `${fmt(prices[prices.length - 1])} now`}
      </span>
    </span>
  );
}
