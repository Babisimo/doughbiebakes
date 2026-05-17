import type { Drop, DropStatus } from "./types";

/**
 * Effective, time-adjusted drop status. The stored `status` field is the
 * baker's intent; the optional `ordersOpenAt` / `ordersCloseAt` datetimes
 * automate the open/close transitions at read time. A drop with no dates
 * behaves exactly as its stored status (fully manual) — dates are opt-in.
 * All comparisons are UTC milliseconds, so server timezone is irrelevant.
 */
export function effectiveDropStatus(drop: Drop, now: Date): DropStatus {
  const nowMs = now.getTime();
  const openMs = drop.ordersOpenAt ? new Date(drop.ordersOpenAt).getTime() : null;
  const closeMs = drop.ordersCloseAt
    ? new Date(drop.ordersCloseAt).getTime()
    : null;
  const past = (ms: number | null) =>
    ms !== null && Number.isFinite(ms) && nowMs >= ms;
  const before = (ms: number | null) =>
    ms !== null && Number.isFinite(ms) && nowMs < ms;

  switch (drop.status) {
    case "draft":
      return "draft";
    case "closed":
      return "closed";
    case "soldout":
      return past(closeMs) ? "closed" : "soldout";
    case "open":
      if (past(closeMs)) return "closed";
      if (before(openMs)) return "announced";
      return "open";
    case "announced":
      if (past(closeMs)) return "closed";
      if (past(openMs)) return "open";
      return "announced";
    default:
      return drop.status;
  }
}

/** A drop customers can see/buy now (announced, open, or sold out). */
export function isCurrentDrop(drop: Drop, now: Date): boolean {
  const eff = effectiveDropStatus(drop, now);
  return eff === "announced" || eff === "open" || eff === "soldout";
}

/** A drop whose window is over — belongs in "Previous drops". */
export function isPreviousDrop(drop: Drop, now: Date): boolean {
  return effectiveDropStatus(drop, now) === "closed";
}

/**
 * Sort key (ms) for "most recent": close date, else pickup date, else
 * created-at. Drops with none of these sort last (0).
 */
export function dropRecencyKey(drop: Drop): number {
  const src = drop.ordersCloseAt ?? drop.pickupOrShipDate ?? drop.createdAt;
  const ms = src ? new Date(src).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}
