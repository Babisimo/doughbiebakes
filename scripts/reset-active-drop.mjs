/**
 * Reset the active drop to a clean, sellable state for a fresh end-to-end test:
 *   - every lineItem.product rewritten to a clean { _type:"reference", _ref }
 *     (strips any corruption like the old `slug`-in-ref bug)
 *   - every lineItem.quantity set back to a uniform stock level (default 8)
 *   - drop status set to "open"
 *
 * Targets drops with status in open/announced/soldout (the ones the storefront
 * treats as live). If more than one matches, it lists them and asks you to
 * pick one with --id=<_id>.
 *
 * DRY RUN by default — prints what it WOULD change and writes nothing:
 *   node --env-file=.env.local scripts/reset-active-drop.mjs
 *   node --env-file=.env.local scripts/reset-active-drop.mjs --qty=10
 * Apply:
 *   node --env-file=.env.local scripts/reset-active-drop.mjs --apply
 *
 * Safe to re-run; idempotent.
 */
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

const APPLY = process.argv.includes("--apply");
const idArg = process.argv.find((a) => a.startsWith("--id="))?.slice(5);
const qtyArg = process.argv.find((a) => a.startsWith("--qty="))?.slice(6);
const QTY = Number.isFinite(Number(qtyArg)) && Number(qtyArg) >= 0 ? Math.floor(Number(qtyArg)) : 8;

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
  return client.fetch(`*[_type == "product" && slug.current == $slug][0]._id`, { slug });
}

const candidates = await client.fetch(
  `*[_type == "drop" && status in ["open","announced","soldout"]]
     | order(coalesce(ordersCloseAt, pickupOrShipDate, _createdAt) desc){ _id, title, status, lineItems }`,
);

if (candidates.length === 0) {
  console.error(
    "No drop with status open/announced/soldout found. Create one in Studio or run `npm run seed:sanity`.",
  );
  process.exit(1);
}

let drop;
if (idArg) {
  drop = candidates.find((d) => d._id === idArg);
  if (!drop) {
    console.error(`No active drop with _id "${idArg}". Candidates:`);
    candidates.forEach((d) => console.error(`  ${d._id} — ${d.title} (${d.status})`));
    process.exit(1);
  }
} else if (candidates.length > 1) {
  console.error("Multiple active drops — re-run with --id=<_id> for one of:");
  candidates.forEach((d) => console.error(`  ${d._id} — ${d.title} (${d.status})`));
  process.exit(1);
} else {
  drop = candidates[0];
}

const items = Array.isArray(drop.lineItems) ? drop.lineItems : [];
console.log(
  `\n${APPLY ? "APPLY" : "DRY RUN"} — ${drop.title} (${drop._id})`,
);
console.log(`  status: ${drop.status} -> open`);

let patch = client.patch(drop._id).set({ status: "open" });
let blocked = false;

for (const li of items) {
  if (!li._key) {
    console.warn("  ! a lineItem has no _key — fix it manually in Studio. Aborting.");
    blocked = true;
    break;
  }
  const refClean = isCleanRef(li.product);
  // eslint-disable-next-line no-await-in-loop
  const refId = refClean ? li.product._ref : await resolveProductId(li.product);
  const label = li.product?.slug?.current ?? li.product?._ref ?? "(unknown)";
  if (!refId) {
    console.warn(`  ! lineItem ${li._key} (${label}) — cannot resolve product id. Aborting.`);
    blocked = true;
    break;
  }
  console.log(
    `  • ${li._key} (${label}): qty ${li.quantity ?? 0} -> ${QTY}` +
      (refClean ? "" : `, product ref CLEANED -> ${refId}`),
  );
  patch = patch.set({ [`lineItems[_key=="${li._key}"].quantity`]: QTY });
  if (!refClean) {
    patch = patch.set({
      [`lineItems[_key=="${li._key}"].product`]: { _type: "reference", _ref: refId },
    });
  }
}

if (blocked) process.exit(1);

if (APPLY) {
  await patch.commit({ autoGenerateArrayKeys: false });
  console.log(`\n✓ APPLIED — ${drop.title} reset to ${QTY}/loaf, status open.`);
} else {
  console.log(`\nDRY RUN — re-run with --apply to write (use --qty=N to change stock).`);
}
