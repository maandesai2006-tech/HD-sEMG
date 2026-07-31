import type { Advice, Position } from "./types";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function positionOf(my: number | null, mkt: number | null): Position {
  if (my == null || mkt == null || mkt === 0) return null;
  const r = my / mkt;
  if (r < 0.85) return "well_below";
  if (r < 0.95) return "below";
  if (r <= 1.05) return "in_line";
  if (r <= 1.15) return "above";
  return "well_above";
}

// Demand proxy 0..100 from two observable signals: how much of the comp set is
// sold out, and how fast the market median has been moving for this date.
export function demandScore(
  soldOutCount: number,
  compCount: number,
  momentumPct: number | null
): number | null {
  if (compCount === 0) return null;
  const soldOutFrac = soldOutCount / compCount;
  // Momentum: +20% median growth ≈ saturated signal.
  const m = momentumPct == null ? 0 : Math.max(0, Math.min(1, momentumPct / 20));
  const score = 65 * soldOutFrac + 35 * m;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function adviceFor(
  position: Position,
  demand: number | null
): Advice {
  if (position == null) return null;
  const hot = demand != null && demand >= 40;
  const cold = demand != null && demand < 15;
  // Priced at/below market on a high-demand night → room to raise.
  if (hot && (position === "well_below" || position === "below" || position === "in_line")) {
    return "raise";
  }
  // Far below market even on a normal night → likely leaving money on the table.
  if (position === "well_below") return "review_low";
  // Far above market on a soft night → risk of losing bookings.
  if (position === "well_above" && !hot) return "review_high";
  if (cold && position === "above") return "review_high";
  return "in_line";
}
