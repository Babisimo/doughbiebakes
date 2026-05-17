import "server-only";

import { sanityClient } from "@/sanity/client";
import {
  ACTIVE_MEMBER_COUNT_QUERY,
  ACTIVE_MEMBERS_QUERY,
  ALL_PRODUCTS_QUERY,
  MEMBER_BY_EMAIL_QUERY,
  MEMBER_SELECTIONS_FOR_DROP_QUERY,
  PRODUCT_BY_SLUG_QUERY,
  PRODUCTS_BY_SLUGS_QUERY,
  RECENT_DROPS_QUERY,
} from "@/sanity/lib/queries";

import type { MemberSelection } from "./availability";
import {
  dropRecencyKey,
  effectiveDropStatus,
  isCurrentDrop,
  isPreviousDrop,
} from "./drop-status";
import { seedDrop, seedPreviousDrops, seedProducts } from "./seed-products";
import { site } from "./site";
import type { Drop, Product } from "./types";

/**
 * Catalog data access. When Sanity is configured we read from the Content Lake;
 * otherwise we fall back to the bundled seed menu so the app runs out of the box.
 */

const REVALIDATE_SECONDS = 60;

// The shared client uses the Sanity CDN (fast, but eventually consistent — it
// can serve a stale snapshot for a short window after a write). For freshness-
// critical reads (the Bread Club selection window, the bake list, the seat
// cap) we derive a non-CDN client that always hits the live Content Lake, so
// a member never sees their own just-saved pick revert.
const freshClient = sanityClient?.withConfig({ useCdn: false }) ?? null;

type FetchOpts = {
  /** Read straight from the live Content Lake (skip the Sanity CDN *and* the
   * Next.js fetch cache). Use where a stale read would be visibly wrong. */
  fresh?: boolean;
};

function fetchSanity<T>(
  query: string,
  params: Record<string, unknown> = {},
  opts: FetchOpts = {},
) {
  if (!sanityClient) return null;
  if (opts.fresh) {
    return (freshClient ?? sanityClient).fetch<T>(query, params, {
      cache: "no-store" as const,
    });
  }
  return sanityClient.fetch<T>(query, params, {
    next: { revalidate: REVALIDATE_SECONDS },
  });
}

function normalizeProduct(p: Partial<Product> | null | undefined): Product | null {
  if (!p || !p.slug || !p.name || typeof p.priceCents !== "number") return null;
  return {
    id: p.id ?? p.slug,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    priceCents: p.priceCents,
    available: p.available ?? true,
    category: p.category,
    imageUrl: p.imageUrl,
    ingredients: p.ingredients,
    allergens: p.allergens,
  };
}

export async function getProducts(): Promise<Product[]> {
  const fromSanity = await fetchSanity<Partial<Product>[]>(ALL_PRODUCTS_QUERY);
  if (fromSanity && fromSanity.length > 0) {
    return fromSanity.map(normalizeProduct).filter((p): p is Product => p !== null);
  }
  return seedProducts;
}

export async function getProduct(slug: string): Promise<Product | null> {
  const fromSanity = await fetchSanity<Partial<Product>>(PRODUCT_BY_SLUG_QUERY, {
    slug,
  });
  const normalized = normalizeProduct(fromSanity);
  if (normalized) return normalized;
  return seedProducts.find((p) => p.slug === slug) ?? null;
}

/** Look up several products by slug — used when pricing a cart server-side. */
export async function getProductsBySlugs(slugs: string[]): Promise<Product[]> {
  if (slugs.length === 0) return [];
  const fromSanity = await fetchSanity<Partial<Product>[]>(
    PRODUCTS_BY_SLUGS_QUERY,
    { slugs },
  );
  if (fromSanity && fromSanity.length > 0) {
    return fromSanity.map(normalizeProduct).filter((p): p is Product => p !== null);
  }
  return seedProducts.filter((p) => slugs.includes(p.slug));
}

function normalizeDrop(raw: Drop | null | undefined): Drop | null {
  if (!raw || !Array.isArray(raw.lineItems)) return null;
  const lineItems = raw.lineItems
    .map((li) => {
      const product = normalizeProduct(
        li.product as unknown as Partial<Product>,
      );
      return product ? { product, quantity: li.quantity ?? 0 } : null;
    })
    .filter((li): li is Drop["lineItems"][number] => li !== null);
  // A drop with no usable line items is misconfigured — skip it.
  if (lineItems.length === 0) return null;
  return { ...raw, lineItems };
}

async function getRecentDrops(opts: FetchOpts = {}): Promise<Drop[]> {
  const fromSanity = await fetchSanity<Drop[]>(RECENT_DROPS_QUERY, {}, opts);
  if (!Array.isArray(fromSanity)) return [];
  return fromSanity
    .map(normalizeDrop)
    .filter((d): d is Drop => d !== null);
}

/**
 * The home page's view of drops: the effective-current drop plus up to 2
 * most-recently-ended ones. One Sanity round-trip, split in memory. Falls
 * back to bundled seed data when Sanity has no usable drops (zero-config).
 */
export async function getDropsView(
  opts: FetchOpts = {},
): Promise<{ current: Drop | null; previous: Drop[] }> {
  const now = new Date();
  const drops = await getRecentDrops(opts);
  if (drops.length === 0) {
    return { current: seedDrop(), previous: seedPreviousDrops() };
  }
  const current = drops.find((d) => isCurrentDrop(d, now)) ?? null;
  const previous = drops
    .filter((d) => isPreviousDrop(d, now))
    .sort((a, b) => dropRecencyKey(b) - dropRecencyKey(a))
    .slice(0, 2);
  return { current, previous };
}

/**
 * The single effective-current drop (effective status announced/open/soldout),
 * or null. Signature unchanged so all existing callers keep working; they now
 * transparently get time-correct open/close behavior. Falls back to the demo
 * drop only when Sanity has no usable drops at all.
 */
export async function getActiveDrop(opts: FetchOpts = {}): Promise<Drop | null> {
  const now = new Date();
  const drops = await getRecentDrops(opts);
  if (drops.length === 0) return seedDrop();
  return drops.find((d) => isCurrentDrop(d, now)) ?? null;
}

/**
 * All Bread Club member selections for one drop. Returns `[]` in demo mode
 * (Sanity not configured) or for a missing drop id.
 *
 * When `drop` is passed and its status has moved past "announced", any active
 * member who never picked gets a synthetic "default" selection pointing at
 * `site.breadClub.defaultLoafSlug`. This is what auto-assigns members to the
 * Classic loaf when they sleep through the selection window.
 */
export async function getMemberSelectionsForDrop(
  dropOrId: Drop | string | undefined | null,
  opts: FetchOpts = {},
): Promise<MemberSelection[]> {
  const dropId =
    typeof dropOrId === "string" ? dropOrId : dropOrId?.id ?? null;
  if (!dropId) return [];

  const fromSanity = await fetchSanity<MemberSelection[]>(
    MEMBER_SELECTIONS_FOR_DROP_QUERY,
    { dropId },
    opts,
  );
  const explicit = (fromSanity ?? []).map((s) => ({ ...s, source: "explicit" as const }));

  const drop = typeof dropOrId === "object" ? dropOrId : null;
  const eff = drop ? effectiveDropStatus(drop, new Date()) : null;
  if (!drop || eff === "announced" || eff === "draft") {
    // Selection window is still open (or not yet opened) — defaults haven't
    // crystallized yet.
    return explicit;
  }

  const defaultSlug = site.breadClub.defaultLoafSlug;
  // Only materialize defaults if the default loaf is actually in this drop.
  const defaultInDrop = drop.lineItems.some((li) => li.product.slug === defaultSlug);
  if (!defaultInDrop) return explicit;

  const allActive = await getActiveMembers(opts);
  if (allActive.length === 0) return explicit;

  const explicitEmails = new Set(explicit.map((s) => s.customerEmail));
  const defaults: MemberSelection[] = allActive
    .filter((m) => !explicitEmails.has(m.customerEmail))
    .map((m) => ({
      customerEmail: m.customerEmail,
      productSlug: defaultSlug,
      fulfillment: "pickup" as const,
      source: "default" as const,
    }));

  return [...explicit, ...defaults];
}

/**
 * How many active (or trialing) Bread Club members are in the cache. Returns
 * `null` in demo mode so callers can distinguish "no cap data" from "zero
 * members" — important so we don't accidentally lock the club when Sanity
 * isn't configured.
 */
export async function getActiveMemberCount(
  opts: FetchOpts = {},
): Promise<number | null> {
  if (!sanityClient) return null;
  const count = await fetchSanity<number>(ACTIVE_MEMBER_COUNT_QUERY, {}, opts);
  return typeof count === "number" ? count : 0;
}

export type ActiveMember = {
  id: string;
  customerEmail: string;
  stripeCustomerId: string;
  subscriptionStatus: string;
  joinedAt: string;
};

/** Every active / trialing member (from the Sanity cache). `[]` in demo mode. */
export async function getActiveMembers(
  opts: FetchOpts = {},
): Promise<ActiveMember[]> {
  if (!sanityClient) return [];
  const fromSanity = await fetchSanity<ActiveMember[]>(
    ACTIVE_MEMBERS_QUERY,
    {},
    opts,
  );
  return fromSanity ?? [];
}

export type MemberRecord = {
  stripeCustomerId: string;
  subscriptionStatus: string;
  customerEmail: string;
};

/** Find one member by email — `null` if not in the cache. */
export async function getMemberByEmail(
  email: string,
  opts: FetchOpts = {},
): Promise<MemberRecord | null> {
  if (!email) return null;
  const fromSanity = await fetchSanity<MemberRecord | null>(
    MEMBER_BY_EMAIL_QUERY,
    { email: email.trim().toLowerCase() },
    opts,
  );
  return fromSanity ?? null;
}
