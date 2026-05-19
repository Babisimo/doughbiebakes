/** Single source of truth for storefront copy, branding, contact info, shipping. */

export const site = {
  /** Brand name shown everywhere. */
  name: "Doughbie",
  shortName: "Doughbie",
  /** Optional legal/DBA name for receipts, the label, etc. */
  legalName: "Doughbie — a home bakery",
  /** One-liner used in the hero, page titles, OG tags. */
  tagline: "Small-batch sourdough, baked at home in Corona, CA.",
  description:
    "Doughbie — naturally leavened sourdough loaves baked in limited weekend drops in Corona, California. Local pickup or California-only shipping.",
  // Update these before launch.
  email: "gondaniel852@gmail.com",
  instagram: "https://instagram.com/doughbbiee",
  // tiktok: "https://tiktok.com/",
  city: "Corona, CA",
  // Required on the California Cottage Food label and shown in the footer.
  cottageFood: {
    permitNumber: "CFO Class A Permit #PENDING",
    madeIn: "Made in a Home Kitchen",
  },
  /**
   * Bread Club subscription — copy shown on /bread-club. These are *display*
   * values: the amount the customer is actually billed comes from the Stripe
   * recurring Price referenced by STRIPE_BREAD_CLUB_PRICE_ID, so keep them in
   * sync (Stripe: $40.00 every 4 weeks). Cap `seats` to ~3 batches' worth so
   * public drops still have loaves to sell.
   */
  breadClub: {
    priceLabel: "$40",
    cadenceLabel: "every 4 weeks",
    perLoafLabel: "about $10 a loaf",
    loavesPerCycle: 4,
    seats: 12,
    /** First N members get a bonus loaf in their first delivery (grand
     * opening). Independent of the founding promo-code cap. */
    foundingSeats: 5,
    /** Product slug a member gets when they don't pick before the window closes. */
    defaultLoafSlug: "classic",
    /** Per-cycle surcharge (cents) when a member chooses "ship" instead of
     * free local pickup. Queued as a one-time line on their next Stripe
     * subscription invoice. Keep in step with the public ca-priority option. */
    shipSurchargeCents: 1200,
  },
} as const;

/**
 * Shipping choices offered at checkout. A 4-loaves-per-batch home baker is
 * realistically pickup-first; California-only shipping is provided per the
 * Cottage Food intrastate rule. Amounts are in cents.
 */
export const shippingOptions = [
  {
    id: "pickup",
    label: "Local pickup — Corona, CA",
    description: "Arrange a pickup time after ordering. Free.",
    amountCents: 0,
    estimate: "Pickup on the drop date",
  },
  {
    id: "ca-priority",
    label: "USPS Priority Mail — California only",
    description: "Ships within California. Cottage Food rules: no out-of-state shipping.",
    amountCents: 1200,
    estimate: "1–3 business days",
  },
] as const;

export type ShippingOptionId = (typeof shippingOptions)[number]["id"];

/** Max loaves a single pay-at-pickup reservation may request. Sized against
 * the ~8–10 loaves/drop home-kitchen capacity (abuse cap, not a price rule). */
export const RESERVATION_MAX_LOAVES = 6;
