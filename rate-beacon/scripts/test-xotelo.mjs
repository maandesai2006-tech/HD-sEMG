#!/usr/bin/env node
// Quick sanity check for the Xotelo data source. Run from any machine:
//
//   node scripts/test-xotelo.mjs "https://www.tripadvisor.com/Hotel_Review-g187147-d197685-Reviews-....html"
//   node scripts/test-xotelo.mjs g187147-d197685
//
// With no argument it uses a well-known hotel (Hôtel Ritz Paris area code).

const input = process.argv[2] ?? "g187147-d188729";

const g = input.match(/[-/]?(g\d+)/i);
const d = input.match(/-(d\d+)/i);
if (!g || !d) {
  console.error("Couldn't find g#####-d##### in the input. Paste a TripAdvisor hotel URL.");
  process.exit(1);
}
const hotelKey = `${g[1]}-${d[1]}`.toLowerCase();

const chkIn = new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10);
const chkOut = new Date(Date.now() + 15 * 86400e3).toISOString().slice(0, 10);

const url = `https://data.xotelo.com/api/rates?hotel_key=${hotelKey}&chk_in=${chkIn}&chk_out=${chkOut}&currency=USD&adults=2&rooms=1`;
console.log(`Hotel key : ${hotelKey}`);
console.log(`Dates     : ${chkIn} → ${chkOut}`);
console.log(`GET ${url}\n`);

const res = await fetch(url);
const json = await res.json();

if (json.error) {
  console.log("API returned an error (often just means no availability):");
  console.log(JSON.stringify(json.error, null, 2));
  process.exit(0);
}

const rates = json.result?.rates ?? [];
if (rates.length === 0) {
  console.log("No offers returned — hotel may be sold out for that night.");
} else {
  console.log(`OTA offers for one night:`);
  for (const r of rates) {
    console.log(
      `  ${String(r.name ?? r.code).padEnd(20)} ${r.rate}${r.tax ? ` (+${r.tax} tax)` : ""}`
    );
  }
  const cheapest = rates.reduce((a, b) =>
    a.rate + (a.tax ?? 0) <= b.rate + (b.tax ?? 0) ? a : b
  );
  console.log(`\nCheapest: ${cheapest.name ?? cheapest.code} at ${cheapest.rate + (cheapest.tax ?? 0)}`);
  console.log("\n✓ Xotelo works — Rate Beacon will be able to pull rates.");
}
