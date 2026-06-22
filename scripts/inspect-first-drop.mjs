/**
 * READ-ONLY inspection for the in-person-sales walkthrough. Writes nothing.
 * Run: node --env-file=.env.local scripts/inspect-first-drop.mjs
 */
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN || process.env.NEXT_PUBLIC_SANITY_API_READ_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID in .env.local.");
  process.exit(1);
}

const client = createClient({ projectId, dataset, token, apiVersion, useCdn: false });

const drops = await client.fetch(
  `*[_type == "drop"] | order(_createdAt desc){
     _id, title, status,
     "lines": lineItems[]{ quantity, "slug": product->slug.current, "name": product->name, "priceCents": product->priceCents }
   }`,
);

console.log("\n=== DROPS (newest first) ===");
for (const d of drops) {
  console.log(`\n• ${d.title}  [${d.status ?? "?"}]  id=${d._id}`);
  for (const l of d.lines ?? []) {
    console.log(`    ${l.name} (${l.slug}) — qty left ${l.quantity ?? 0} — base $${((l.priceCents ?? 0) / 100).toFixed(2)}`);
  }
}

const res = await client.fetch(
  `*[_type == "reservation"] | order(_createdAt asc){
     _id, customerName, customerEmail, status, channel, totalCents,
     "drop": drop->title,
     items[]{ productName, productSlug, quantity, priceCents }
   }`,
);

console.log("\n\n=== RESERVATIONS (oldest first) ===");
for (const r of res) {
  console.log(
    `\n• ${r.customerName ?? "(no name)"} [${r.status ?? "?"}]${r.channel ? ` (${r.channel})` : ""} — ${r.drop ?? "?"} — total $${((r.totalCents ?? 0) / 100).toFixed(2)}`,
  );
  console.log(`    id=${r._id}  email=${r.customerEmail ?? "—"}`);
  for (const it of r.items ?? []) {
    console.log(`    ${it.quantity}× ${it.productName} (${it.productSlug}) @ $${((it.priceCents ?? 0) / 100).toFixed(2)}`);
  }
}
console.log("");
