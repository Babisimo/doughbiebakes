import { effectiveDropStatus } from "./drop-status.ts";
import type { Drop } from "./types.ts";

/**
 * Whether a drop's flash sale is live right now. Time-aware and gated to OPEN
 * drops — a sale only applies while customers can actually buy. Mirrors the
 * UTC-milliseconds comparisons in `drop-status.ts`. Returns full-price
 * (`active: false`, `percentOff: 0`) for any drop without an active sale, so
 * seed/zero-config drops are handled without special-casing.
 */
export type FlashSaleState = {
  active: boolean;
  percentOff: number;
  endsAt?: string;
  headline?: string;
};

const INACTIVE: FlashSaleState = { active: false, percentOff: 0 };

export function flashSaleStatus(drop: Drop | null, now: Date): FlashSaleState {
  const fs = drop?.flashSale;
  if (!drop || !fs || !fs.enabled) return INACTIVE;

  const endsMs = fs.endsAt ? new Date(fs.endsAt).getTime() : NaN;
  if (!Number.isFinite(endsMs)) return INACTIVE;

  const nowMs = now.getTime();
  if (nowMs >= endsMs) return INACTIVE;

  if (fs.startsAt) {
    const startsMs = new Date(fs.startsAt).getTime();
    if (Number.isFinite(startsMs) && nowMs < startsMs) return INACTIVE;
  }

  if (effectiveDropStatus(drop, now) !== "open") return INACTIVE;

  const pct = Math.floor(fs.percentOff);
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) return INACTIVE;

  return { active: true, percentOff: pct, endsAt: fs.endsAt, headline: fs.headline };
}

export type DiscountSource = "flash" | "promo" | "none";

export type ResolvedDiscount = {
  percentOff: number;
  source: DiscountSource;
  /** Human label for a flash-sale discount (no promo code exists). */
  label?: string;
};

/**
 * Pick the single larger discount between an active flash sale and a typed
 * promo code. Never stacks. Ties go to the flash sale (no code to type is the
 * better experience). Pass 0 for whichever isn't present.
 */
export function resolveDiscount(input: {
  flashPercent: number;
  promoPercent: number;
}): ResolvedDiscount {
  const flash = Math.max(0, Math.floor(input.flashPercent) || 0);
  const promo = Math.max(0, Math.floor(input.promoPercent) || 0);
  if (flash === 0 && promo === 0) return { percentOff: 0, source: "none" };
  if (flash >= promo) {
    return { percentOff: flash, source: "flash", label: `Flash Sale −${flash}%` };
  }
  return { percentOff: promo, source: "promo" };
}
