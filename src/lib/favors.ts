/**
 * Pure favor/discount math. No I/O — integer cents in, integer cents out.
 *
 * A "favor" is the gap between a loaf's list price and what was actually
 * charged, clamped at zero (charging *above* list is never a negative favor).
 */

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
