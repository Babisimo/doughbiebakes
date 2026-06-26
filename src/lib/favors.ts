/**
 * Pure favor/discount math. No I/O — integer cents in, integer cents out.
 *
 * A "favor" is the gap between a loaf's list price and what was actually
 * charged, clamped at zero (charging *above* list is never a negative favor).
 */

import { resolveDiscount } from "./flash-sale.ts";
import { discountedTotalCents } from "./promo-math.ts";

export type SaleLineInput = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
  listPriceCents: number;
};

const intNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const centsNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Total collected and favors given for one in-person sale's lines. */
export function computeSaleTotals(items: SaleLineInput[]): {
  totalCents: number;
  favorsCents: number;
} {
  let totalCents = 0;
  let favorsCents = 0;
  for (const it of items) {
    const qty = intNonNeg(it.quantity);
    if (qty === 0) continue;
    const price = centsNonNeg(it.priceCents);
    const list = centsNonNeg(it.listPriceCents);
    totalCents += qty * price;
    favorsCents += qty * Math.max(0, list - price);
  }
  return { totalCents, favorsCents };
}

export type InPersonSaleResult = {
  /** Full subtotal at the charged per-line prices (before any flash discount). */
  totalCents: number;
  /** Per-line favors given (list − charged), independent of the flash sale. */
  favorsCents: number;
  /** Flash-sale percent applied to the whole sale, when one is live. */
  promoPercentOff?: number;
  /** Subtotal after the flash discount. Present only when a sale is live. */
  discountedTotalCents?: number;
  /** Human label for the discount, e.g. "Flash Sale −20%". */
  discountLabel?: string;
  /** What the baker actually collects — the discounted total when a sale is
   * live. Mirrors `discountedTotalCents`; stored separately so the books
   * ("Actually collected") reflect the sale without re-deriving the percent. */
  collectedCents?: number;
};

/**
 * One in-person sale's money, sale-aware. Per-line prices drive the subtotal
 * and any manual favors (a friend's deal); a live flash sale then discounts the
 * whole subtotal — the same percent-off-the-total model the storefront and
 * online reservations use. A flash markdown is a sale, not a "favor", so it
 * never inflates `favorsCents`. Pass `0` for `flashPercentOff` when no sale is
 * live (the common case), and you get the plain undiscounted totals back.
 */
export function computeInPersonSale(
  items: SaleLineInput[],
  flashPercentOff: number,
): InPersonSaleResult {
  const { totalCents, favorsCents } = computeSaleTotals(items);
  const winner = resolveDiscount({ flashPercent: flashPercentOff, promoPercent: 0 });
  if (winner.source === "none" || winner.percentOff <= 0) {
    return { totalCents, favorsCents };
  }
  const discounted = discountedTotalCents(totalCents, winner.percentOff);
  return {
    totalCents,
    favorsCents,
    promoPercentOff: winner.percentOff,
    discountedTotalCents: discounted,
    discountLabel: winner.label,
    collectedCents: discounted,
  };
}

/**
 * Re-derive an in-person sale's money after its lines (quantities/prices) are
 * amended, re-applying a stored flash-sale percent to the new subtotal. Pass the
 * reservation's saved `promoPercentOff` (0/null/undefined ⇒ no sale). When a sale
 * applies, `collectedCents` mirrors the discounted total — that's what the baker
 * actually collects and what the books read. Mirrors {@link computeInPersonSale}.
 */
export function recomputeAmendedSale(
  items: SaleLineInput[],
  promoPercentOff: number | null | undefined,
): { totalCents: number; discountedTotalCents?: number; collectedCents?: number } {
  const { totalCents } = computeSaleTotals(items);
  const pct = Math.max(0, Math.floor(Number(promoPercentOff) || 0));
  if (pct <= 0) return { totalCents };
  const discounted = discountedTotalCents(totalCents, pct);
  return { totalCents, discountedTotalCents: discounted, collectedCents: discounted };
}

export type SoldItem = {
  productSlug: string;
  quantity: number;
  priceCents?: number;
};

export type SoldSource = { items: SoldItem[] };

/**
 * Real favors given across a drop's orders/reservations: for every item with a
 * known list price and a recorded charged price, sum max(0, list - charged) x qty.
 * Items missing a price or an unknown slug contribute nothing.
 */
export function actualFavorsCents(
  sources: SoldSource[],
  listPriceBySlug: Map<string, number>,
): number {
  let favors = 0;
  for (const src of sources) {
    for (const it of src.items) {
      if (typeof it.priceCents !== "number") continue;
      const list = listPriceBySlug.get(it.productSlug);
      if (typeof list !== "number") continue;
      const qty = intNonNeg(it.quantity);
      favors += qty * Math.max(0, centsNonNeg(list) - centsNonNeg(it.priceCents));
    }
  }
  return favors;
}

export type FavorSource = {
  who: string;
  items: {
    productSlug: string;
    productName?: string;
    quantity: number;
    priceCents?: number;
  }[];
};

export type FavorLine = {
  who: string;
  productName: string;
  /** Whole units, ≥ 1. */
  quantity: number;
  /** Per-unit price actually charged. */
  chargedCents: number;
  /** Per-unit list price. */
  listCents: number;
  /** Line total given away = qty × max(0, list − charged). */
  favorCents: number;
};

/**
 * Itemized favors given across a drop's orders/reservations: one line per item
 * actually sold below list, carrying who got it and on what loaf. Items at/above
 * list, with an unknown slug, or with no recorded charged price produce no line.
 * Sorted by favor descending (biggest giveaways first); the summed `favorCents`
 * equals {@link actualFavorsCents} for the same input.
 */
export function favorLines(
  sources: FavorSource[],
  listPriceBySlug: Map<string, number>,
): FavorLine[] {
  const lines: FavorLine[] = [];
  for (const src of sources) {
    for (const it of src.items) {
      if (typeof it.priceCents !== "number") continue;
      const list = listPriceBySlug.get(it.productSlug);
      if (typeof list !== "number") continue;
      const qty = intNonNeg(it.quantity);
      if (qty === 0) continue;
      const charged = centsNonNeg(it.priceCents);
      const listCents = centsNonNeg(list);
      const favorCents = qty * Math.max(0, listCents - charged);
      if (favorCents <= 0) continue;
      lines.push({
        who: src.who,
        productName: it.productName ?? it.productSlug,
        quantity: qty,
        chargedCents: charged,
        listCents,
        favorCents,
      });
    }
  }
  // Stable sort (Node/V8) keeps input order on ties.
  lines.sort((a, b) => b.favorCents - a.favorCents);
  return lines;
}

/**
 * What a reservation actually collected: the explicit `collectedCents` override
 * when set, otherwise the reserved `totalCents`. A `$0` override is honored
 * (a loaf reserved for yourself), so only a non-number falls back.
 */
export function reservationCollectedCents(r: {
  collectedCents?: number | null;
  totalCents: number;
}): number {
  return typeof r.collectedCents === "number" && Number.isFinite(r.collectedCents)
    ? r.collectedCents
    : r.totalCents;
}
