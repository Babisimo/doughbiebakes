/**
 * Pre-launch test-data cleanup. Run this once, right before flipping Stripe
 * to live mode, to start from a clean Sanity dataset.
 *
 * Deletes (in dependency-safe order):
 *   - every `memberCharge` doc       (references member — child of member)
 *   - every `memberSelection` doc    (references drop — child of drop)
 *   - every `member` doc             (Bread Club join cache)
 *   - every `reservation` doc        (references drop — child of drop)
 *   - every `order` doc with livemode == false  (test-mode public orders)
 *   - every `drop` doc               (the test "First Drop" — bake a fresh one)
 *   - every `promoCode` doc          (clears the FOUNDING / etc. test codes)
 *
 * With `--include-categories` (DESTRUCTIVE, harder to recover):
 *   Also unsets `category` on every product, then deletes every `category`.
 *   Products survive but lose their category link until you re-assign in
 *   Studio. Skip unless you genuinely want to redo your category taxonomy.
 *
 * Always keeps:
 *   - `product` (your real menu)
 *   - `order` docs with livemode == true (real money orders — none yet)
 *   - by default: `category` (see above)
 *
 * DRY RUN by default — prints counts and IDs, writes nothing:
 *   npm run prelaunch:cleanup
 * Apply:
 *   npm run prelaunch:cleanup -- --apply
 *   npm run prelaunch:cleanup -- --apply --include-categories
 */
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

const APPLY = process.argv.includes("--apply");
const INCLUDE_CATEGORIES = process.argv.includes("--include-categories");

if (!projectId || !token) {
  console.error(
    "Missing NEXT_PUBLIC_SANITY_PROJECT_ID and/or SANITY_API_WRITE_TOKEN in .env.local.",
  );
  process.exit(1);
}

const client = createClient({ projectId, dataset, token, apiVersion, useCdn: false });

// Order matters: Sanity blocks delete-with-references, so children must go
// before parents. memberCharge → member, memberSelection → drop, order →
// drop, reservation → drop. So: all drop-children first, then drops.
const targets = [
  { label: "memberCharges",     query: `*[_type == "memberCharge"]._id` },
  { label: "memberSelections",  query: `*[_type == "memberSelection"]._id` },
  { label: "members",           query: `*[_type == "member"]._id` },
  { label: "reservations",      query: `*[_type == "reservation"]._id` },
  { label: "test-mode orders",  query: `*[_type == "order" && livemode == false]._id` },
  { label: "drops",             query: `*[_type == "drop"]._id` },
  { label: "promoCodes",        query: `*[_type == "promoCode"]._id` },
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

// Optional category sweep — unset product.category on every product first
// (so the reference is gone), then delete every category doc.
if (INCLUDE_CATEGORIES) {
  const products = await client.fetch(
    `*[_type == "product" && defined(category)]._id`,
  );
  const categories = await client.fetch(`*[_type == "category"]._id`);
  console.log(
    `\n  • category sweep: unset category on ${products.length} product(s); delete ${categories.length} category doc(s)`,
  );
  for (const id of products) console.log(`      - unset on ${id}`);
  for (const id of categories) console.log(`      - delete ${id}`);

  if (APPLY) {
    try {
      if (products.length > 0) {
        let tx = client.transaction();
        for (const id of products) tx = tx.patch(id, (p) => p.unset(["category"]));
        await tx.commit({ autoGenerateArrayKeys: false });
      }
      if (categories.length > 0) {
        let tx = client.transaction();
        for (const id of categories) tx = tx.delete(id);
        await tx.commit({ autoGenerateArrayKeys: false });
        totalDeleted += categories.length;
      }
    } catch (err) {
      console.error(`      ✘ category sweep failed:`, err?.message ?? err);
      totalFailed += categories.length;
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
  console.log(
    `\nDRY RUN — re-run with --apply to delete.` +
      (INCLUDE_CATEGORIES ? "" : "\n(--include-categories also clears the category taxonomy.)"),
  );
}
