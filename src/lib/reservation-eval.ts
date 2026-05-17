import { availabilityOf, buildAvailability, type MemberSelection } from "./availability.ts";
import { effectiveDropStatus } from "./drop-status.ts";
import type { Drop } from "./types.ts";

export type ReqItem = { slug: string; quantity: number };
export type PricedItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};
export type EvalReason =
  | "empty"
  | "not-open"
  | "not-in-drop"
  | "soldout"
  | "qty-exceeded";
export type EvalResult =
  | { ok: true; items: PricedItem[]; totalCents: number }
  | { ok: false; reason: EvalReason; message: string };

/**
 * Pure: given the open drop, member claims, and a requested cart, either
 * price the cart or explain the first rejection. Same rules as /api/checkout.
 */
export function evaluateReservation(
  drop: Drop | null,
  memberSelections: MemberSelection[],
  items: ReqItem[],
  now: Date,
): EvalResult {
  if (!items || items.length === 0) {
    return { ok: false, reason: "empty", message: "Your order is empty." };
  }
  if (!drop || effectiveDropStatus(drop, now) !== "open") {
    return {
      ok: false,
      reason: "not-open",
      message: "Ordering isn't open right now — check the current drop.",
    };
  }
  const availability = buildAvailability(drop, memberSelections, now);
  const bySlug = new Map(drop.lineItems.map((li) => [li.product.slug, li.product]));
  const priced: PricedItem[] = [];
  for (const item of items) {
    const product = bySlug.get(item.slug);
    const a = availabilityOf(availability, item.slug);
    if (!product || a.reason === "not-in-drop") {
      return {
        ok: false,
        reason: "not-in-drop",
        message: `"${item.slug}" isn't part of this week's drop.`,
      };
    }
    if (!a.canOrder) {
      return {
        ok: false,
        reason: "soldout",
        message: `"${product.name}" is sold out.`,
      };
    }
    if (a.remaining != null && item.quantity > a.remaining) {
      return {
        ok: false,
        reason: "qty-exceeded",
        message: `Only ${a.remaining} ${a.remaining === 1 ? "loaf" : "loaves"} of "${product.name}" left.`,
      };
    }
    priced.push({
      productSlug: product.slug,
      productName: product.name,
      quantity: item.quantity,
      priceCents: product.priceCents,
    });
  }
  const totalCents = priced.reduce((s, p) => s + p.priceCents * p.quantity, 0);
  return { ok: true, items: priced, totalCents };
}
