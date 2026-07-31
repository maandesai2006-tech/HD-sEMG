# Rate Beacon

A free, self-hosted hotel **rate intelligence dashboard** — a lightweight
Lighthouse/OTA-Insight-style tool. Track what competitor hotels charge night by
night, spot high-demand dates, see where your own rate sits against the market,
and watch how prices move over time.

Rate data comes from the **free, keyless [Xotelo API](https://xotelo.com)**,
which serves TripAdvisor's public meta-search prices across OTAs (Booking.com,
Expedia, Agoda, …). Hosting fits entirely in **Vercel + Supabase free tiers**.
No paid services, no API keys for the data source.

> Originally built on the Amadeus Self-Service API, which was decommissioned
> on July 17, 2026 — Xotelo replaced it and is a better fit anyway: any hotel
> on TripAdvisor works, identified simply by its TripAdvisor page URL.

## What it does

- **Competitor rate grid** — paste your hotel's TripAdvisor link, pick 5–10
  competitors (from the same location or by pasting their links); see
  everyone's cheapest-OTA nightly rate for the next 7–120 days in a
  color-coded grid (blue = cheaper than that night's market median,
  red = pricier).
- **Your rate vs the market** — mark your own hotel, or type your rates
  directly into the grid if you're not on TripAdvisor; every night is banded
  well-below → well-above market.
- **Advice column** — ▲ *Raise* (at/below market on a high-demand night),
  ▲ *Low?* (far below market), ▼ *High* (well above a soft market).
- **Demand signal (0–100)** — built from how much of the comp set is sold out
  plus how fast the market median has been climbing for that date.
- **Rate history** — a daily snapshot job stores every rate; click any date to
  see per-hotel price-evolution sparklines, and hover any cell to see which
  OTA had the cheapest offer.

## Try the data source first (10 seconds)

From any machine with Node 18+:

```bash
node scripts/test-xotelo.mjs "https://www.tripadvisor.com/Hotel_Review-g…-d…-Reviews-….html"
```

Paste your own hotel's TripAdvisor URL — it prints the live OTA offers for a
night two weeks out.

## Setup (~15 minutes, all free)

### 1. Supabase database (~5 min)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project's **SQL Editor**, paste and run
   [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).
3. From *Project Settings → API* copy the **Project URL** and the
   **service_role key** (server-only — never expose it in a browser).

> Already done for this repo's owner: the project **rate-beacon**
> (`https://fcyghazlfnytejvdxkfk.supabase.co`, us-east-1) exists with the
> schema applied — just grab the service_role key from its dashboard.

### 2. Deploy to Vercel (~10 min)

1. Import the repo on [vercel.com](https://vercel.com). If it lives in a
   subfolder of a larger repo, set **Root Directory** to `rate-beacon`.
2. Add the environment variables from [`.env.example`](.env.example):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD` (the dashboard
   login), and `CRON_SECRET` (any long random string — protects the daily job).
3. Deploy. `vercel.json` registers a **daily cron at 06:00 UTC** that snapshots
   all rates; Vercel authenticates it automatically with `CRON_SECRET`.

Open the site → enter the password → **Set up your market** (paste your
hotel's TripAdvisor link, add competitors) → hit **Refresh rates** once. From
then on the daily job keeps the history building automatically.

### Local development

```bash
cp .env.example .env.local   # fill in your Supabase values
npm install
npm run dev                  # http://localhost:3000
```

## Notes & limits

- **Request volume**: one Xotelo lookup per hotel per night — a daily snapshot
  of 6 hotels × 45 days ≈ 270 requests, spread over a couple of minutes with 4
  concurrent workers and retry/backoff. Keep the horizon modest; be polite to
  a free service (there's a [donate page](https://xotelo.com/donate.html)).
- **Hotel coverage**: any property with a TripAdvisor page that shows prices.
  If your own hotel isn't listed, leave "mine" unticked and type your rates
  straight into the *you* column — comparisons work the same.
- **Prices are the cheapest OTA offer** for a 1-night, 2-adult stay — the same
  "market rate" a guest comparison-shopping would see. Hover a cell to see
  which OTA it came from.
- **Demand & advice are heuristics** built only from observable signals (comp
  sold-outs, median momentum). They're a starting point for a pricing
  decision, not a revenue-management system.
- The snapshot route runs up to 300 s per invocation; for very large
  horizon × hotel combinations call `POST /api/refresh?maxDates=30` in chunks.
- Xotelo is an unofficial free service — if it ever disappears, the data layer
  is isolated in [`src/lib/xotelo.ts`](src/lib/xotelo.ts) and can be swapped
  for another provider without touching the dashboard, database, or insights.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · Supabase (Postgres) ·
Xotelo API (`/api/rates`, `/api/list`) · Vercel Cron.
