import type { Drop } from "./types.ts";
import { effectiveDropStatus } from "./drop-status.ts";

/**
 * Whether a loaf can be added to an order right now, and why not if it can't.
 *
 * The **open drop is the single source of truth** for what's buyable: a loaf is
 * orderable only if it's a line item in the open drop, that line still has
 * stock, and the product itself is marked available. Loaves already claimed by
 * Bread Club members are subtracted from each flavor's public quantity, so
 * the public never reserves a loaf a member is going to walk away with.
 */
export type Availability = {
  /** Can a customer add this loaf to their cart at all? */
  canOrder: boolean;
  /** Loaves left for this loaf in the current drop; `null` if it isn't in one. */
  remaining: number | null;
  reason?: "soldout" | "not-in-drop" | "not-open";
};

/** A member's pick for a drop. `fulfillment` is optional so older docs
 * without the field (pre-toggle) still parse cleanly. */
export type Fulfillment = "pickup" | "ship";

export type MemberSelection = {
  customerEmail: string;
  productSlug: string;
  fulfillment?: Fulfillment;
  /** Whether the member explicitly skipped this drop. Always `false` for
   * default selections; the query coalesces null/missing to false. */
  skipped: boolean;
  /** "default" means the member never picked and this is the auto-assigned
   * Classic loaf computed at read time. "explicit" (or undefined) is a real
   * pick the member made in /club. */
  source?: "explicit" | "default";
};

const NOT_IN_DROP: Availability = {
  canOrder: false,
  remaining: null,
  reason: "not-in-drop",
};

/**
 * Build a `slug -> Availability` map from the active drop, member picks, and
 * `reservationHolds` — a `slug -> quantity` map of loaves spoken for by
 * email-confirmed-but-not-yet-approved reservations. Holds are subtracted from
 * the public count just like member claims.
 */
export function buildAvailability(
  drop: Drop | null,
  memberSelections: MemberSelection[] = [],
  now: Date = new Date(),
  reservationHolds: Map<string, number> = new Map(),
): Map<string, Availability> {
  const map = new Map<string, Availability>();
  if (!drop) return map;
  const eff = effectiveDropStatus(drop, now);
  const open = eff === "open";

  const claimedBySlug = new Map<string, number>();
  for (const sel of memberSelections) {
    claimedBySlug.set(sel.productSlug, (claimedBySlug.get(sel.productSlug) ?? 0) + 1);
  }

  for (const { product, quantity } of drop.lineItems) {
    const raw = Math.max(0, Math.floor(quantity ?? 0));
    const claimed = claimedBySlug.get(product.slug) ?? 0;
    const held = reservationHolds.get(product.slug) ?? 0;
    const remaining = Math.max(0, raw - claimed - held);

    let entry: Availability;
    if (!open) {
      entry = {
        canOrder: false,
        remaining,
        reason: eff === "announced" ? "not-open" : "soldout",
      };
    } else if (!product.available || remaining <= 0) {
      entry = { canOrder: false, remaining, reason: "soldout" };
    } else {
      entry = { canOrder: true, remaining };
    }
    map.set(product.slug, entry);
  }
  return map;
}

/** Availability for one slug — defaults to "not in this week's drop". */
export function availabilityOf(
  map: Map<string, Availability>,
  slug: string,
): Availability {
  return map.get(slug) ?? NOT_IN_DROP;
}

/** Short label for an unavailable loaf (disabled buttons, corner badges). */
export function unavailableLabel(reason: Availability["reason"]): string {
  switch (reason) {
    case "not-in-drop":
      return "Not in this drop";
    case "not-open":
      return "Coming soon";
    default:
      return "Sold out";
  }
}
