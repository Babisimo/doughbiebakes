import { site } from "./site.ts";

/** Whole-dollar Bread Club drop price (cents) — $10, plus the ship surcharge
 * when the member chose shipping over free local pickup. */
export function dropChargeCents(fulfillment: "pickup" | "ship"): number {
  const base = 1000;
  return fulfillment === "ship" ? base + site.breadClub.shipSurchargeCents : base;
}

/**
 * Whether the per-drop charge run should attempt a charge for a member.
 * `selection` is the member's memberSelection for this drop (null = silent);
 * `existingChargeStatus` is any prior memberCharge for (drop, member).
 * Skipped members and already-paid members are not charged; a prior failure
 * is retried; silence means "in" (charge + default loaf).
 */
export function shouldChargeMember(
  selection: { skipped?: boolean } | null,
  existingChargeStatus: "paid" | "failed" | null,
): boolean {
  if (selection?.skipped) return false;
  if (existingChargeStatus === "paid") return false;
  return true;
}
