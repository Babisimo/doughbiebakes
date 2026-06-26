/**
 * Pure favor/discount math. No I/O — integer cents in, integer cents out.
 *
 * A "favor" is the gap between a loaf's list price and what was actually
 * charged, clamped at zero (charging *above* list is never a negative favor).
 */

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

/**
 * A loaf's effective "going price" — the favor baseline. During a flash sale
 * that's the sale price (`list − percentOff%`); with no sale it's the list price.
 * A favor is only what's charged *below* this, so a sale markdown everyone gets
 * is never miscounted as a personal favor. 0/null/undefined percent ⇒ list.
 */
export function effectiveListCents(
  listCents: number,
  promoPercentOff?: number | null,
): number {
  const list = centsNonNeg(listCents);
  const pct = Math.max(0, Math.floor(Number(promoPercentOff) || 0));
  return pct > 0 ? discountedTotalCents(list, pct) : list;
}

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

export type SoldItem = {
  productSlug: string;
  quantity: number;
  priceCents?: number;
};

/**
 * One sale's items, plus the flash-sale percent that applied to it (when any).
 * The percent marks the favor baseline down to the sale price — see
 * {@link effectiveListCents}.
 */
export type SoldSource = { items: SoldItem[]; promoPercentOff?: number | null };

/**
 * Real favors given across a drop's orders/reservations: for every item with a
 * known list price and a recorded charged price, sum max(0, baseline - charged)
 * x qty, where `baseline` is the sale price when the sale carried a flash percent.
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
      const baseline = effectiveListCents(list, src.promoPercentOff);
      favors += qty * Math.max(0, baseline - centsNonNeg(it.priceCents));
    }
  }
  return favors;
}

export type FavorSource = {
  who: string;
  promoPercentOff?: number | null;
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
      // Baseline is the sale price when the sale carried a flash percent, so a
      // markdown everyone gets isn't shown as a personal favor.
      const listCents = effectiveListCents(list, src.promoPercentOff);
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
