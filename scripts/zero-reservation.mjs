/**
 * Zero out a single reservation's collected amount — set every item's
 * priceCents to 0 and totalCents to 0. Used to mark a loaf the baker reserved
 * for themselves (or fully comped) so it stays on the bake list but counts as
 * $0 collected. Under the favors model this registers as a favor equal to the
 * full list price of each item.
 *
 * DRY RUN by default — prints before/after, writes nothing:
 *   node --env-file=.env.local scripts/zero-reservation.mjs <reservationId>
 * Apply (DESTRUCTIVE):
 *   node --env-file=.env.local scripts/zero-reservation.mjs <reservationId> --apply
 */
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

const APPLY = process.argv.includes("--apply");
const id = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);

if (!projectId || !token) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID and/or SANITY_API_WRITE_TOKEN in .env.local.");
  process.exit(1);
}
if (!id) {
  console.error("Usage: node --env-file=.env.local scripts/zero-reservation.mjs <reservationId> [--apply]");
  process.exit(1);
}

const client = createClient({ projectId, dataset, token, apiVersion, useCdn: false });

const r = await client.fetch(
  `*[_type == "reservation" && _id == $id][0]{
     _id, customerName, status, channel, totalCents,
     "drop": drop->title,
     items[]
   }`,
  { id },
);

if (!r) {
  console.error(`No reservation found with id ${id}.`);
  process.exit(1);
}

console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — zero reservation`);
console.log(`Dataset: ${projectId}/${dataset}\n`);
console.log(`• ${r.customerName ?? "(no name)"} [${r.status ?? "?"}]${r.channel ? ` (${r.channel})` : ""} — ${r.drop ?? "?"}`);
console.log(`    id=${r._id}`);
console.log(`    BEFORE: total $${((r.totalCents ?? 0) / 100).toFixed(2)}`);
for (const it of r.items ?? []) {
  console.log(`      ${it.quantity}× ${it.productName} (${it.productSlug}) @ $${((it.priceCents ?? 0) / 100).toFixed(2)}`);
}
console.log(`    AFTER:  total $0.00  (every item @ $0.00)`);

if (!APPLY) {
  console.log(`\nDRY RUN — re-run with --apply to write these changes.`);
  process.exit(0);
}

// Rewrite the whole items array with priceCents zeroed (the items carry no
// array _key, so a positional/keyed patch can't target them) and zero the
// total. Every other item field is preserved verbatim.
const zeroedItems = (r.items ?? []).map((it) => ({ ...it, priceCents: 0 }));

try {
  await client
    .patch(r._id)
    .set({ totalCents: 0, items: zeroedItems })
    .commit({ autoGenerateArrayKeys: false });
  console.log(`\nDONE — reservation ${r._id} zeroed.`);
} catch (err) {
  console.error(`\n✘ patch failed:`, err?.message ?? err);
  process.exit(1);
}
