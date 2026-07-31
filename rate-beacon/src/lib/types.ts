export interface Settings {
  id: number;
  hotel_name: string | null;
  city_code: string | null;
  city_name: string | null;
  currency: string;
  horizon_days: number;
  adults: number;
}

export interface Hotel {
  hotel_id: string;
  name: string;
  is_mine: boolean;
  city_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface RateCell {
  price: number | null;
  available: boolean;
  roomDesc: string | null;
  capturedOn: string | null;
}

export type Position =
  | "well_below"
  | "below"
  | "in_line"
  | "above"
  | "well_above"
  | null;

export type Advice = "raise" | "review_low" | "review_high" | "in_line" | null;

export interface GridRow {
  date: string; // check-in date YYYY-MM-DD
  cells: Record<string, RateCell>; // hotelId -> cell
  myPrice: number | null;
  myPriceSource: "manual" | "amadeus" | null;
  median: number | null;
  min: number | null;
  max: number | null;
  compCount: number;
  soldOutCount: number;
  demand: number | null; // 0..100
  momentumPct: number | null; // % change of market median vs ~7 days ago
  position: Position;
  advice: Advice;
}

export interface GridResponse {
  settings: Settings;
  hotels: Hotel[];
  rows: GridRow[];
  weekdayAvg: { weekday: number; avgMedian: number | null }[];
  lastCapturedAt: string | null;
}

export interface HistoryPoint {
  capturedOn: string;
  price: number | null;
  available: boolean;
}
