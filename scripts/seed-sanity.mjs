/**
 * One-shot seed: pushes the starter menu (2 categories, 5 loaves) and a sample
 * "open" drop into the configured Sanity dataset. Mirrors src/lib/seed-products.ts.
 *
 * Run:  npm run seed:sanity      (loads .env.local automatically)
 *
 * Safe to re-run — uses createIfNotExists, so it never overwrites edits you've
 * made in the Studio. To start over, delete the docs in the Studio and re-run.
 */
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-01-01";

if (!projectId || !token) {
  console.error(
    "Missing NEXT_PUBLIC_SANITY_PROJECT_ID and/or SANITY_API_WRITE_TOKEN. " +
      "Set them in .env.local (or your environment) and try again.",
  );
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion,
  useCdn: false,
});

const categories = [
  {
    _id: "category.signature-loaves",
    _type: "category",
    title: "Signature Loaves",
    slug: { _type: "slug", current: "signature-loaves" },
    description: "The everyday classics.",
  },
  {
    _id: "category.inclusions",
    _type: "category",
    title: "Inclusions",
    slug: { _type: "slug", current: "inclusions" },
    description: "Loaves folded with something extra.",
  },
];

const ref = (id) => ({ _type: "reference", _ref: id });

const products = [
  {
    _id: "product.classic",
    name: "Classic",
    slug: "classic",
    tagline: "The signature loaf — crackly crust, open crumb.",
    description:
      "Naturally leavened over ~24 hours, baked dark in a Dutch oven. Just flour, water, salt, and our sourdough starter. The everyday loaf.",
    priceCents: 1100,
    category: ref("category.signature-loaves"),
    ingredients: [
      "Bread flour",
      "Water",
      "Sourdough starter (flour, water)",
      "Sea salt",
    ],
    allergens: ["Wheat"],
  },
  {
    _id: "product.cheddar-jalapeno",
    name: "Cheddar & Jalapeño",
    slug: "cheddar-jalapeno",
    tagline: "Sharp cheddar pockets and a slow jalapeño heat.",
    description:
      "Our country loaf folded with aged cheddar and fresh jalapeño. Toasts into something close to a grilled cheese on its own.",
    priceCents: 1300,
    category: ref("category.inclusions"),
    ingredients: [
      "Bread flour",
      "Water",
      "Sourdough starter (flour, water)",
      "Aged cheddar cheese (milk, cheese cultures, salt, enzymes)",
      "Fresh jalapeño",
      "Sea salt",
    ],
    allergens: ["Wheat", "Milk"],
  },
  {
    _id: "product.pepperoni-garlic",
    name: "Pepperoni & Garlic",
    slug: "pepperoni-garlic",
    tagline: "Pizza night in loaf form.",
    description:
      "Studded with pepperoni and roasted garlic. Warm it up, tear it apart — no sauce required.",
    priceCents: 1300,
    category: ref("category.inclusions"),
    ingredients: [
      "Bread flour",
      "Water",
      "Sourdough starter (flour, water)",
      "Pepperoni (pork, beef, spices, paprika, garlic, sodium nitrite)",
      "Roasted garlic",
      "Sea salt",
    ],
    allergens: ["Wheat"],
  },
  {
    _id: "product.banana-brown-sugar-cinnamon",
    name: "Banana, Brown Sugar & Cinnamon",
    slug: "banana-brown-sugar-cinnamon",
    tagline: "Banana bread's sourdough cousin.",
    description:
      "Ripe banana, brown sugar, and cinnamon swirled through a soft sourdough. Excellent toasted with butter.",
    priceCents: 1300,
    category: ref("category.inclusions"),
    ingredients: [
      "Bread flour",
      "Water",
      "Sourdough starter (flour, water)",
      "Ripe banana",
      "Brown sugar",
      "Cinnamon",
      "Sea salt",
    ],
    allergens: ["Wheat"],
  },
  {
    _id: "product.strawberry",
    name: "Strawberry",
    slug: "strawberry",
    tagline: "Jammy strawberry through a tender crumb.",
    description:
      "Folded with strawberries and a touch of sugar for a lightly sweet loaf — breakfast, basically.",
    priceCents: 1300,
    category: ref("category.inclusions"),
    ingredients: [
      "Bread flour",
      "Water",
      "Sourdough starter (flour, water)",
      "Strawberries",
      "Cane sugar",
      "Sea salt",
    ],
    allergens: ["Wheat"],
  },
].map((p) => ({
  _id: p._id,
  _type: "product",
  name: p.name,
  slug: { _type: "slug", current: p.slug },
  tagline: p.tagline,
  description: p.description,
  priceCents: p.priceCents,
  available: true,
  category: p.category,
  ingredients: p.ingredients,
  allergens: p.allergens,
}));

const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const drop = {
  _id: "drop.opening-weekend",
  _type: "drop",
  title: "Opening Weekend Drop",
  slug: { _type: "slug", current: "opening-weekend" },
  status: "open",
  ordersOpenAt: new Date(now - 2 * day).toISOString(),
  ordersCloseAt: new Date(now + 3 * day).toISOString(),
  pickupOrShipDate: new Date(now + 5 * day).toISOString(),
  note: "Local pickup in Corona, or USPS Priority shipping within California. Edit me in the Studio.",
  lineItems: products.map((p, i) => ({
    _type: "dropLineItem",
    _key: p._id.replace("product.", ""),
    product: ref(p._id),
    quantity: i === 0 ? 4 : 2,
  })),
};

async function run() {
  console.log(`Seeding ${projectId}/${dataset} …`);
  for (const doc of [...categories, ...products, drop]) {
    const res = await client.createIfNotExists(doc);
    console.log(`  ${res._id}`);
  }
  console.log("Done. Open the Studio at /studio (or `npx sanity dev`) to edit.");
}

run().catch((err) => {
  console.error("Seed failed:", err?.message || err);
  process.exit(1);
});
