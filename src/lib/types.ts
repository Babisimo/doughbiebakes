/** Shared domain types used by both the Sanity-backed and seed-backed paths. */

/** A pantry item with its bulk price, used to auto-cost recipes. */
export type Ingredient = {
  id: string;
  name: string;
  packagePriceCents: number;
  packageQty: number;
  unit?: string;
};

/** One line of a loaf's recipe: how much of an ingredient it uses. */
export type RecipeLine = {
  qtyPerLoaf: number;
  ingredient?: Ingredient | null;
};

export type Product = {
  /** Stable id — Sanity `_id` or the seed slug. */
  id: string;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  priceCents: number;
  /** Baker's variable cost to produce one, in cents. Optional — flat-cost
   * fallback used by the ROI calculator when there's no recipe. */
  defaultCostCents?: number;
  /** Optional recipe; when present it auto-costs the loaf from pantry prices. */
  recipe?: RecipeLine[];
  available: boolean;
  category?: string;
  /** Absolute URL (Sanity CDN) or path under /public (seed). */
  imageUrl?: string;
  ingredients?: string[];
  allergens?: string[];
};

export type DropStatus =
  | "draft"
  | "announced"
  | "open"
  | "soldout"
  | "closed";

export type DropLineItem = {
  product: Product;
  quantity: number;
};

export type Drop = {
  id: string;
  slug: string;
  title: string;
  status: DropStatus;
  ordersOpenAt?: string;
  ordersCloseAt?: string;
  pickupOrShipDate?: string;
  /** Sanity `_createdAt` — final fallback for recency sorting. */
  createdAt?: string;
  note?: string;
  lineItems: DropLineItem[];
  flashSale?: {
    enabled: boolean;
    percentOff: number;
    startsAt?: string;
    endsAt?: string;
    headline?: string;
  };
};

/** A saved per-drop financial snapshot (one per drop), rolled up by the
 * weekly/monthly dashboard. Cents throughout; numbers are frozen at save time. */
export type DropFinancials = {
  id: string;
  /** Null for manual / pre-website entries. */
  dropId?: string | null;
  dropTitle: string;
  /** ISO date used to bucket into a week/month. */
  periodDate?: string;
  revenueCents: number;
  listValueCents: number;
  favorsCents: number;
  variableCostCents: number;
  fixedCostCents: number;
  netProfitCents: number;
  unitsTotal: number;
  actualCollectedCents: number;
  fixedCosts?: { name: string; cents: number }[];
  savedAt?: string;
};

/** Item as stored in the browser cart — price is re-resolved server-side. */
export type CartLine = {
  slug: string;
  quantity: number;
};
