/**
 * One-time migration to Model B (sale price baked into in-person line prices).
 * Read-only by default; pass --apply to write.
 *   node --env-file=.env.local scripts/migrate-favor-baseline.mjs          # dry run
 *   node --env-file=.env.local scripts/migrate-favor-baseline.mjs --apply  # write
 *
 * Converts the two existing flash-sale in-person reservations:
 *  - Victoria (free favor, promoPercentOff missing): set promoPercentOff=15 so her
 *    favor is valued at the $10.20 sale price, not full $12 list.
 *  - Erin Lomeli (old discount-on-total format): reprice each line to the sale
 *    price, set totalCents=Σ, and unset the legacy discountedTotalCents/collectedCents.
 */
import { createClient } from "@sanity/client";
import { favorLines, actualFavorsCents } from "../src/lib/favors.ts";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  token: process.env.SANITY_API_WRITE_TOKEN,
  apiVersion: "2025-01-01",
  useCdn: false,
});
const APPLY = process.argv.includes("--apply");
const PCT = 15; // the live Fourth-of-July flash sale

const products = await client.fetch(`*[_type=="product"]{ "slug": slug.current, priceCents }`);
const listBySlug = new Map(products.map((p) => [p.slug, p.priceCents]));

const rows = await client.fetch(
  `*[_type=="reservation" && customerName in ["Victoria","Erin Lomeli"] && channel=="in-person"]{
    "id":_id, customerName, items[]{ productSlug, productName, quantity, priceCents }
  }`,
);

for (const r of rows) {
  let patch = client.patch(r.id);
  if (r.customerName === "Victoria") {
    patch = patch.set({ promoPercentOff: PCT, discountLabel: `Flash Sale −${PCT}%` });
    console.log("Victoria: set promoPercentOff=15 + discountLabel");
  } else {
    const items = r.items.map((i) => {
      const list = listBySlug.get(i.productSlug) ?? i.priceCents;
      const sale = list - Math.round((list * PCT) / 100);
      return { _type: "reservationItem", productSlug: i.productSlug, productName: i.productName, quantity: i.quantity, priceCents: sale };
    });
    const total = items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
    patch = patch.set({ items, totalCents: total, promoPercentOff: PCT, discountLabel: `Flash Sale −${PCT}%` })
      .unset(["discountedTotalCents", "collectedCents"]);
    console.log(`Erin: reprice -> ${items.map((i) => `${i.quantity}x ${i.productSlug} @${i.priceCents}`).join(", ")}, total=${total}, unset discountedTotalCents+collectedCents`);
  }
  if (APPLY) { await patch.commit({ autoGenerateArrayKeys: false }); console.log(`  committed ${r.id}`); }
}

const after = await client.fetch(
  `*[_type=="reservation" && customerName in ["Victoria","Erin Lomeli"] && channel=="in-person"]{
    customerName, promoPercentOff, items[]{ productSlug, productName, quantity, priceCents }
  }`,
);
const sources = after.map((r) => ({ who: r.customerName, promoPercentOff: r.promoPercentOff, items: r.items }));
console.log(`\n--- favors from ${APPLY ? "POST-WRITE" : "CURRENT (no write yet)"} data ---`);
for (const l of favorLines(sources, listBySlug))
  console.log(`  ${l.who}: ${l.productName} favor $${(l.favorCents / 100).toFixed(2)} (baseline $${(l.listCents / 100).toFixed(2)}, charged $${(l.chargedCents / 100).toFixed(2)})`);
console.log(`  TOTAL favors $${(actualFavorsCents(sources, listBySlug) / 100).toFixed(2)}`);
console.log(`\nMode: ${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
