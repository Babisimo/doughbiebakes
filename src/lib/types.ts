/** Shared domain types used by both the Sanity-backed and seed-backed paths. */

export type Product = {
  /** Stable id — Sanity `_id` or the seed slug. */
  id: string;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  priceCents: number;
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
  note?: string;
  lineItems: DropLineItem[];
};

/** Item as stored in the browser cart — price is re-resolved server-side. */
export type CartLine = {
  slug: string;
  quantity: number;
};
