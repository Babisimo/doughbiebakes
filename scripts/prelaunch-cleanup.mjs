/**
 * Pre-launch test-data cleanup. Run this once, right before flipping Stripe
 * to live mode, to start from a clean Sanity dataset.
 *
 * Deletes:
 *   - every `member` doc            (every cached Bread Club join from test mode)
 *   - every `memberSelection` doc   (per-drop flavor picks from test members)
 *   - every `memberCharge` doc      (off-session charges from test mode)
 *   - every `reservation` doc       (test reservation requests)
 *   - every `order` doc with livemode == false  (test-mode public orders)
 *
 * Keeps:
 *   - `product`, `category`, `drop`, `promoCode` (your real menu + first drop)
 *   - `order` docs with livemode == true (none yet; future live orders)
 *
 * DRY RUN by default — prints counts and IDs, writes nothing:
 *   npm run prelaunch:cleanup
 * Apply (DESTRUCTIVE):
 *   npm run prelaunch:cleanup -- --apply
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

// Order matters: Sanity blocks delete-with-references, so children must go
// before parents. memberCharge → references member (delete first); same for
// memberSelection's drop ref (we don't touch drops, so it's harmless either way).
const targets = [
  { label: "memberCharges",     query: `*[_type == "memberCharge"]._id` },
  { label: "memberSelections",  query: `*[_type == "memberSelection"]._id` },
  { label: "members",           query: `*[_type == "member"]._id` },
  { label: "reservations",      query: `*[_type == "reservation"]._id` },
  { label: "test-mode orders",  query: `*[_type == "order" && livemode == false]._id` },
];

console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — prelaunch cleanup`);
console.log(`Dataset: ${projectId}/${dataset}\n`);

let totalDeleted = 0;
let totalFailed = 0;

for (const { label, query } of targets) {
  const ids = await client.fetch(query);
  if (!Array.isArray(ids) || ids.length === 0) {
    console.log(`  • ${label}: 0 — nothing to delete`);
    continue;
  }
  console.log(`  • ${label}: ${ids.length}`);
  for (const id of ids) console.log(`      - ${id}`);

  if (APPLY) {
    // memberCharge → member is a reference relationship; deleting the parent
    // member while child charges still reference it would 409. Order matters:
    // memberCharges first, then memberSelections, then members (above order
    // does this naturally). Sanity also auto-handles weak refs gracefully.
    let tx = client.transaction();
    for (const id of ids) tx = tx.delete(id);
    try {
      await tx.commit({ autoGenerateArrayKeys: false });
      totalDeleted += ids.length;
    } catch (err) {
      console.error(`      ✘ ${label} delete failed:`, err?.message ?? err);
      totalFailed += ids.length;
    }
  }
}

if (APPLY) {
  console.log(
    `\n${totalFailed > 0 ? "PARTIAL" : "DONE"} — deleted ${totalDeleted}` +
      (totalFailed > 0 ? `, ${totalFailed} failed (see errors above)` : ""),
  );
  if (totalFailed > 0) process.exit(1);
} else {
  console.log(`\nDRY RUN — re-run with --apply to delete.`);
}
