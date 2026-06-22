/**
 * Clear reservation docs from Sanity — and ONLY reservations.
 *
 * Use this to reset test reservations, e.g. to clear the per-email dedupe that
 * blocks re-submitting the same email for a drop. Drops, products, promos,
 * members, and orders are all left untouched, so an open drop stays open.
 *
 * Reservations reference a drop (they're the child), so deleting them is safe
 * and needs no ordering — the drop they point at is unaffected.
 *
 * DRY RUN by default — prints count + IDs, writes nothing:
 *   npm run reservations:clear
 * Apply (DESTRUCTIVE):
 *   npm run reservations:clear -- --apply
 */
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

const APPLY = process.argv.includes("--apply");

if (!projectId || !token) {
  console.error(
    "Missing NEXT_PUBLIC_SANITY_PROJECT_ID and/or SANITY_API_WRITE_TOKEN in .env.local.",
  );
  process.exit(1);
}

const client = createClient({ projectId, dataset, token, apiVersion, useCdn: false });

const rows = await client.fetch(
  `*[_type == "reservation"]{ _id, customerEmail, status, "drop": drop->title } | order(_createdAt asc)`,
);

console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — clear reservations`);
console.log(`Dataset: ${projectId}/${dataset}\n`);

if (!Array.isArray(rows) || rows.length === 0) {
  console.log("  • reservations: 0 — nothing to delete");
  process.exit(0);
}

console.log(`  • reservations: ${rows.length}`);
for (const r of rows) {
  console.log(
    `      - ${r._id}  ${r.customerEmail ?? "(no email)"}  [${r.status ?? "?"}]` +
      (r.drop ? `  · ${r.drop}` : ""),
  );
}

if (!APPLY) {
  console.log(
    `\nDRY RUN — re-run with --apply to delete these ${rows.length} reservation(s).`,
  );
  process.exit(0);
}

let tx = client.transaction();
for (const r of rows) tx = tx.delete(r._id);
try {
  await tx.commit({ autoGenerateArrayKeys: false });
  console.log(`\nDONE — deleted ${rows.length} reservation(s).`);
} catch (err) {
  console.error(`\n✘ delete failed:`, err?.message ?? err);
  process.exit(1);
}
