/** Whole-cent discount for a subtotal at `percentOff` (1–100). Used by the
 * reservation flow and the storefront's discounted-total display. (Stripe
 * orders apply the discount with a Stripe coupon, off the order total.) */
export function discountCents(subtotalCents: number, percentOff: number): number {
  return Math.round((subtotalCents * percentOff) / 100);
}

export function discountedTotalCents(
  subtotalCents: number,
  percentOff: number,
): number {
  return Math.max(0, subtotalCents - discountCents(subtotalCents, percentOff));
}
