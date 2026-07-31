# Rate Beacon

A free, self-hosted hotel **rate intelligence dashboard** — a lightweight
Lighthouse/OTA-Insight-style tool. Track what competitor hotels charge night by
night, spot high-demand dates, see where your own rate sits against the market,
and watch how prices move over time.

Data comes from the **[Amadeus Self-Service API](https://developers.amadeus.com)**
(free tier). Hosting fits entirely in **Vercel + Supabase free tiers**.

## What it does

- **Competitor rate grid** — pick your city, your hotel, and 5–10 competitors;
  see everyone's nightly rate for the next 7–120 days in a color-coded grid
  (blue = cheaper than that night's market median, red = pricier).
- **Your rate vs the market** — mark your own hotel (if it's bookable via
  Amadeus) or type your rates directly into the grid; every night is banded
  well-below → well-above market.
- **Advice column** — ▲ *Raise* (at/below market on a high-demand night),
  ▲ *Low?* (far below market), ▼ *High* (well above a soft market).
- **Demand signal (0–100)** — built from how much of the comp set is sold out
  plus how fast the market median has been climbing for that date.
- **Rate history** — a daily snapshot job stores every rate; click any date to
  see per-hotel price-evolution sparklines.

## Setup (about 20 minutes, all free)

### 1. Amadeus API keys (~5 min)

1. Create a free account at [developers.amadeus.com](https://developers.amadeus.com).
2. *My Self-Service Workspace → Create New App* — copy the **API Key** and
   **API Secret**.
3. Keys start in the **test** environment: free, but hotel data is limited and
   partly cached — fine for trying the app. For real live rates, request
   **production keys** in the same dashboard (still free up to a monthly quota;
   card details required but the Hotel Search free tier is generous).

### 2. Supabase database (~5 min)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project's **SQL Editor**, paste and run
   [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).
3. From *Project Settings → API* copy the **Project URL** and the
   **service_role key** (server-only — never expose it in a browser).

### 3. Deploy to Vercel (~10 min)

1. Push this folder to a GitHub repo (or use it where it lives) and *Import*
   it on [vercel.com](https://vercel.com). If it lives in a subfolder of a
   larger repo, set **Root Directory** to `rate-beacon`.
2. Add the environment variables from [`.env.example`](.env.example):
   `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD` (the dashboard
   login), and `CRON_SECRET` (any long random string — protects the daily job).
3. Deploy. `vercel.json` registers a **daily cron at 06:00 UTC** that snapshots
   all rates; Vercel authenticates it automatically with `CRON_SECRET`.

Open the site → enter the password → **Set up your market** → hit
**Refresh rates** once. From then on the cron keeps history building daily.

### Local development

```bash
cp .env.example .env.local   # fill in your keys
npm install
npm run dev                  # http://localhost:3000
```

## Notes & limits

- **API quota math**: one snapshot = `horizon_days × ceil(hotels / 20)` Amadeus
  calls (60 days × ≤20 hotels ≈ 60 calls/day ≈ 1.8k/month) — comfortably inside
  the free tier. Keep the horizon modest if you track many hotels.
- **Test vs production**: `AMADEUS_ENV=test` returns sandbox data (some cities
  sparse, prices not live). Switch to `production` for real rates.
- **Hotel coverage**: Amadeus exposes GDS-connected hotels. Small independents
  are sometimes missing — if yours is, leave "mine" unticked and type your
  rates straight into the *you* column; comparisons work the same.
- **Demand & advice are heuristics** built only from observable signals (comp
  sold-outs, median momentum). They're a starting point for a pricing decision,
  not a revenue-management system.
- The serverless snapshot route caps at 60 s; with very large horizons call
  `POST /api/refresh?maxDates=30` twice rather than raising the horizon.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · Supabase (Postgres) ·
Amadeus Self-Service APIs (`/v1/reference-data/locations`,
`/v1/…/hotels/by-city`, `/v3/shopping/hotel-offers`) · Vercel Cron.

No paid services, no scraping, no tracking.
