import { createClient } from "@sanity/client";

/**
 * One-off: seed the pantry ingredients we priced out together and give each
 * photographed loaf a recipe so the ROI calculator auto-costs it.
 *
 * Per-loaf inclusion AMOUNTS are rough estimates (the baker wasn't sure) — easy
 * to fine-tune in the Studio. Prices/package sizes are from real receipts.
 * Re-running is safe: ingredients use deterministic ids and loaf patches only
 * set `recipe` + `defaultCostCents`.
 *
 *   node --env-file=.env.local scripts/seed-costs.mjs
 */
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? process.env.SANITY_API_VERSION ?? "2024-01-01",
  token: process.env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
});

const ING = {
  flour: "ingredient.kirkland-organic-ap-flour",
  kaFlour: "ingredient.king-arthur-bread-flour",
  salt: "ingredient.kirkland-pink-salt",
  pepperoni: "ingredient.pepperoni",
  jalapeno: "ingredient.jalapeno",
  cheddar: "ingredient.lucerne-sharp-cheddar",
  mozzarella: "ingredient.family-mozzarella",
  basil: "ingredient.basil-seasoning",
  italian: "ingredient.italian-seasoning",
};

// Pantry — real package prices/sizes. Flour & salt in grams; the rest in their
// store units (oz, or "each" for a single jalapeño).
const INGREDIENTS = [
  { _id: ING.flour, name: "Kirkland Organic AP Flour", packagePriceCents: 1999, packageQty: 9072, unit: "g", note: "Costco — $1.00/lb (20 lb)" },
  { _id: ING.kaFlour, name: "King Arthur Bread Flour", packagePriceCents: 1134, packageQty: 5443, unit: "g", note: "Costco — $0.945/lb (12 lb)" },
  { _id: ING.salt, name: "Kirkland Pink Salt (fine)", packagePriceCents: 799, packageQty: 2268, unit: "g", note: "Costco (5 lb)" },
  { _id: ING.pepperoni, name: "Pepperoni", packagePriceCents: 299, packageQty: 6, unit: "oz" },
  { _id: ING.jalapeno, name: "Green Jalapeño", packagePriceCents: 25, packageQty: 1, unit: "each" },
  { _id: ING.cheddar, name: "Lucerne Sharp Cheddar (shredded)", packagePriceCents: 349, packageQty: 8, unit: "oz" },
  { _id: ING.mozzarella, name: "Family Mozzarella", packagePriceCents: 799, packageQty: 32, unit: "oz" },
  { _id: ING.basil, name: "Basil Leaves Seasoning", packagePriceCents: 249, packageQty: 0.62, unit: "oz" },
  { _id: ING.italian, name: "Italian Seasoning", packagePriceCents: 299, packageQty: 0.75, unit: "oz" },
];

// Base dough every loaf shares (≈ $1.25/loaf).
const BASE = [
  { ref: ING.flour, qtyPerLoaf: 550 }, // 500g + ~50g from starter
  { ref: ING.salt, qtyPerLoaf: 10 },
];

// recipe (lines) + a flat fallback cost (defaultCostCents) per loaf.
const LOAVES = {
  classic: { lines: BASE, cost: 125 },
  "brown-sugar-cinnamon": { lines: BASE, cost: 125 }, // add-ins TBD
  strawberry: { lines: BASE, cost: 125 }, // add-ins TBD
  "jalapeno-cheddar": {
    lines: [...BASE, { ref: ING.jalapeno, qtyPerLoaf: 1 }, { ref: ING.cheddar, qtyPerLoaf: 3 }],
    cost: 281,
  },
  "pepperoni-sourdough": {
    lines: [
      ...BASE,
      { ref: ING.pepperoni, qtyPerLoaf: 1 },
      { ref: ING.mozzarella, qtyPerLoaf: 3 },
      { ref: ING.basil, qtyPerLoaf: 0.03 },
      { ref: ING.italian, qtyPerLoaf: 0.03 },
    ],
    cost: 274,
  },
};

async function main() {
  if (!process.env.SANITY_API_WRITE_TOKEN) {
    throw new Error("SANITY_API_WRITE_TOKEN missing — can't write.");
  }

  for (const ing of INGREDIENTS) {
    await client.createOrReplace({ _type: "ingredient", ...ing });
    console.log(`ingredient ✓ ${ing.name}`);
  }

  for (const [slug, { lines, cost }] of Object.entries(LOAVES)) {
    const id = await client.fetch(`*[_type=="product" && slug.current==$slug][0]._id`, { slug });
    if (!id) {
      console.log(`skip — no product "${slug}"`);
      continue;
    }
    const recipe = lines.map((r, i) => ({
      _type: "recipeLine",
      _key: `seed-${i}`,
      ingredient: { _type: "reference", _ref: r.ref },
      qtyPerLoaf: r.qtyPerLoaf,
    }));
    await client.patch(id).set({ recipe, defaultCostCents: cost }).commit();
    console.log(`loaf ✓ ${slug} → $${(cost / 100).toFixed(2)}`);
  }

  console.log("\nDone. Tweak inclusion amounts per loaf in the Studio anytime.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
