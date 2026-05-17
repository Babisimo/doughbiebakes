import type { Drop, Product } from "./types";

/**
 * Bundled menu used when Sanity is not yet connected (no
 * NEXT_PUBLIC_SANITY_PROJECT_ID). Mirrors the product roadmap in
 * SOURDOUGH_BUSINESS_LOG.md so the storefront is fully browsable on day one.
 * Once the CMS is live, this is only used as a fallback.
 */
export const seedProducts: Product[] = [
  {
    id: "classic",
    slug: "classic",
    name: "Classic",
    tagline: "The signature loaf — crackly crust, open crumb.",
    description:
      "Naturally leavened over ~24 hours, baked dark in a Dutch oven. Just flour, water, salt, and our sourdough starter. The everyday loaf.",
    priceCents: 1100,
    available: true,
    category: "Signature Loaves",
    ingredients: ["Bread flour", "Water", "Sourdough starter (flour, water)", "Sea salt"],
    allergens: ["Wheat"],
  },
  {
    id: "cheddar-jalapeno",
    slug: "cheddar-jalapeno",
    name: "Cheddar & Jalapeño",
    tagline: "Sharp cheddar pockets and a slow jalapeño heat.",
    description:
      "Our country loaf folded with aged cheddar and fresh jalapeño. Toasts into something close to a grilled cheese on its own.",
    priceCents: 1300,
    available: true,
    category: "Inclusions",
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
    id: "pepperoni-garlic",
    slug: "pepperoni-garlic",
    name: "Pepperoni & Garlic",
    tagline: "Pizza night in loaf form.",
    description:
      "Studded with pepperoni and roasted garlic. Warm it up, tear it apart — no sauce required.",
    priceCents: 1300,
    available: true,
    category: "Inclusions",
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
    id: "banana-brown-sugar-cinnamon",
    slug: "banana-brown-sugar-cinnamon",
    name: "Banana, Brown Sugar & Cinnamon",
    tagline: "Banana bread's sourdough cousin.",
    description:
      "Ripe banana, brown sugar, and cinnamon swirled through a soft sourdough. Excellent toasted with butter.",
    priceCents: 1300,
    available: true,
    category: "Inclusions",
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
    id: "strawberry",
    slug: "strawberry",
    name: "Strawberry",
    tagline: "Jammy strawberry through a tender crumb.",
    description:
      "Folded with strawberries and a touch of sugar for a lightly sweet loaf — breakfast, basically.",
    priceCents: 1300,
    available: true,
    category: "Inclusions",
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
];

/** A demo "drop" so the home page has something live before the CMS is wired. */
export function seedDrop(): Drop {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return {
    id: "seed-drop",
    slug: "this-weekend",
    title: "This Weekend's Drop",
    status: "open",
    ordersOpenAt: new Date(now - 2 * day).toISOString(),
    ordersCloseAt: new Date(now + 2 * day).toISOString(),
    pickupOrShipDate: new Date(now + 4 * day).toISOString(),
    note: "Local pickup in Corona, or USPS Priority shipping within California. Sample drop — replace via the CMS or Sanity Studio.",
    // A realistic mix so the demo shows every state: the signature loaf in good
    // supply, a couple of each inclusion, and one flavor already sold out (so
    // the "Sold out" / "Notify me" UI is visible without editing anything).
    lineItems: seedProducts.map((product, i) => ({
      product,
      quantity: i === 0 ? 4 : product.slug === "strawberry" ? 0 : 2,
    })),
  };
}
