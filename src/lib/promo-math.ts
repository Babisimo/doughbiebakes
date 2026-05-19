/** Whole-cent discount for a subtotal at `percentOff` (1–100). Single
 * rounding rule shared by the reservation and Stripe paths. */
export function discountCents(subtotalCents: number, percentOff: number): number {
  return Math.round((subtotalCents * percentOff) / 100);
}

export function discountedTotalCents(
  subtotalCents: number,
  percentOff: number,
): number {
  return Math.max(0, subtotalCents - discountCents(subtotalCents, percentOff));
}

/** Per-unit discounted price for Stripe line items; never below 1 cent
 * (Stripe rejects 0). Per-unit rounding can differ from `discountedTotalCents`
 * by up to ~1 cent per line item — intentional and harmless (the two paths
 * never reconcile the same order). */
export function discountedUnitCents(
  unitCents: number,
  percentOff: number,
): number {
  return Math.max(1, unitCents - discountCents(unitCents, percentOff));
}
