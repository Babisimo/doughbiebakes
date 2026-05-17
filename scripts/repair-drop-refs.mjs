/**
 * One-shot repair for drops whose lineItem `product` references were corrupted
 * by the old applyOrderToActiveDrop bug (it wrote the dereferenced product back,
 * producing refs like { _ref, _type:"reference", slug:{…} } that Sanity Studio
 * refuses to save: `Key "slug" not allowed in ref`).
 *
 * It rewrites every malformed lineItem `product` to a clean
 * { _type:"reference", _ref:<productId> }, addressed by the lineItem `_key`
 * so nothing else on the document is touched.
 *
 * DRY RUN by default — prints what it WOULD change and writes nothing:
 *   node --env-file=.env.local scripts/repair-drop-refs.mjs
 * Apply the fixes:
 *   node --env-file=.env.local scripts/repair-drop-refs.mjs --apply
 *
 * Safe to re-run; clean references are skipped.
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

const ALLOWED_REF_KEYS = new Set(["_ref", "_type", "_key", "_weak", "_strengthenOnPublish"]);

function isCleanRef(p) {
  return (
    p &&
    typeof p === "object" &&
    p._type === "reference" &&
    typeof p._ref === "string" &&
    p._ref.length > 0 &&
    Object.keys(p).every((k) => ALLOWED_REF_KEYS.has(k))
  );
}

async function resolveProductId(product) {
  if (product && typeof product._ref === "string" && product._ref.length > 0) {
    return product._ref;
  }
  const slug = product?.slug?.current;
  if (!slug) return null;
  return client.fetch(`*[_type == "product" && slug.current == $slug][0]._id`, {
    slug,
  });
}

const drops = await client.fetch(
  `*[_type == "drop"]{ _id, title, lineItems }`,
);

let dropsTouched = 0;
let itemsFixed = 0;
let unresolved = 0;

for (const drop of drops) {
  const items = Array.isArray(drop.lineItems) ? drop.lineItems : [];
  const fixes = [];
  for (const li of items) {
    if (isCleanRef(li.product)) continue;
    if (!li._key) {
      console.warn(
        `  ! ${drop.title} (${drop._id}): a corrupt lineItem has no _key — skip, fix manually in Studio.`,
      );
      unresolved++;
      continue;
    }
    const refId = await resolveProductId(li.product);
    if (!refId) {
      console.warn(
        `  ! ${drop.title} (${drop._id}): lineItem ${li._key} — cannot resolve a product id (no _ref, no slug). Skipped.`,
      );
      unresolved++;
      continue;
    }
    fixes.push({ key: li._key, refId, before: JSON.stringify(li.product) });
  }

  if (fixes.length === 0) continue;
  dropsTouched++;
  console.log(`\n${drop.title} (${drop._id}) — ${fixes.length} lineItem(s):`);
  for (const f of fixes) {
    console.log(`  • ${f.key}: ${f.before} -> { _type:"reference", _ref:"${f.refId}" }`);
  }
  itemsFixed += fixes.length;

  if (APPLY) {
    let patch = client.patch(drop._id);
    for (const f of fixes) {
      patch = patch.set({
        [`lineItems[_key=="${f.key}"].product`]: {
          _type: "reference",
          _ref: f.refId,
        },
      });
    }
    await patch.commit({ autoGenerateArrayKeys: false });
    console.log(`  ✓ applied`);
  }
}

console.log(
  `\n${APPLY ? "APPLIED" : "DRY RUN"} — drops with fixes: ${dropsTouched}, lineItems ${
    APPLY ? "fixed" : "to fix"
  }: ${itemsFixed}${unresolved ? `, unresolved (manual): ${unresolved}` : ""}`,
);
if (!APPLY && itemsFixed > 0) {
  console.log("Re-run with --apply to write these changes.");
}
