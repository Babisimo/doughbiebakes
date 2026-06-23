# Flash Sales + Auto-Discounts — Design

**Date:** 2026-06-23
**Status:** Approved (brainstorm) → ready for implementation plan
**Roadmap:** First of three marketing builds (Flash sales → Loyalty → Corporate). The
other two get their own spec → plan → build cycles later.

## Problem & goal

Drive impulse buys with **time-boxed, auto-applied discounts** that create urgency.
The "risk-free / bake-after-orders" idea from the source material is already how the
shop works (drops + reservations are reserve-then-bake), so the *new* primitive is an
**automatic discount on a short window** — no code to type — surfaced loudly enough to
trigger an impulse purchase, that **expires on its own** with zero baker cleanup.

Must be usable **today**, during pre-launch: online Stripe payments are gated, so the
discount has to work in the `/reserve` pay-at-pickup flow as well as online checkout.

## Approach (chosen: A — flash sale as fields on the Drop)

A flash sale is modeled as an optional object on the existing **Drop**, not a new
document type and not an extension of `promoCode`. Rationale:

- One source of truth; reuses the drop lifecycle, the time-aware status engine
  (`src/lib/drop-status.ts`), and the existing `Countdown` component.
- A "sporadic surprise sale" is just editing the active drop in Studio (set a percent
  + a short window) — instant, no new workflow.
- Fits the business: everything is sold through a drop, one active at a time.

Rejected alternatives: a standalone `sale` document (more wiring, flexibility not
needed with one baker / one active drop — YAGNI); extending `promoCode` with
auto-apply + window (muddies the "code" abstraction and entangles sales with the
redemption-cap counter, which sales don't want).

**No stacking:** a flash sale and a typed promo code never combine. The buyer gets
**whichever single discount is larger**. (Stripe sessions take one coupon anyway.)

## 1. Data model

### Drop schema — `src/sanity/schemaTypes/drop.ts`

Add one optional `flashSale` object field:

| Field        | Type     | Notes |
|--------------|----------|-------|
| `enabled`    | boolean  | Master on/off. Default false. |
| `percentOff` | number   | 1–100, integer. Validation matches `promoCode.percentOff`. |
| `startsAt`   | datetime | Optional. Omitted = live the moment `enabled` is true. |
| `endsAt`     | datetime | **Required when enabled** — the urgency deadline. |
| `headline`   | string   | Optional, e.g. "Surprise Saturday — 20% off everything". |

Studio validation: when `enabled` is true, require `percentOff` and `endsAt`; if both
`startsAt` and `endsAt` are present, require `endsAt > startsAt`.

### Domain type — `src/lib/types.ts`

Add to `Drop`:

```ts
flashSale?: {
  enabled: boolean;
  percentOff: number;
  startsAt?: string;
  endsAt?: string;
  headline?: string;
};
```

### Sanity query

Extend the drop projection(s) (in `src/sanity/lib/queries.ts` and anywhere a drop is
fetched for the storefront) to include the `flashSale` object so the field reaches the
storefront and the API routes.

## 2. Discount resolution

### Pure helper — `src/lib/flash-sale.ts` (new)

```ts
export type FlashSaleState = {
  active: boolean;
  percentOff: number;     // 0 when inactive
  endsAt?: string;
  headline?: string;
};

export function flashSaleStatus(drop: Drop | null, now: Date): FlashSaleState;
```

`active` is true only when **all** hold:
- `drop.flashSale?.enabled` is true,
- `now >= startsAt` (or no `startsAt`),
- `now < endsAt` (a valid `endsAt` is present),
- `effectiveDropStatus(drop, now) === "open"`.

All comparisons in UTC milliseconds, mirroring `drop-status.ts`. When inactive,
`percentOff` is 0 and the rest are undefined.

### Pure helper — `resolveDiscount` (new, in `src/lib/flash-sale.ts` or a small
`discount.ts`)

```ts
export type DiscountSource = "flash" | "promo" | "none";
export type ResolvedDiscount = {
  percentOff: number;          // 0 when none
  source: DiscountSource;
  label?: string;              // e.g. "Flash Sale −20%" when source === "flash"
};

export function resolveDiscount(input: {
  flashPercent: number;        // 0 if no active flash sale
  promoPercent: number;        // 0 if no valid code
}): ResolvedDiscount;
```

Returns the **larger** of the two percents. Ties go to `flash` (no code needed is the
better customer experience). When the winner is the flash sale, `label` is set so the
record/email can show it without a promo code.

### Reserve path — `src/app/api/reserve/route.ts` (lines ~124–150)

Today this block resolves a typed promo code and stores
`promoCode` / `promoPercentOff` / `discountedTotalCents` on the reservation. Change:

1. Compute `flashSaleStatus(drop, new Date())` for the active drop.
2. Resolve the typed code as today (`getPromoByCode` + `isRedeemable`).
3. `resolveDiscount({ flashPercent, promoPercent })`.
4. Apply the winner:
   - **promo wins:** unchanged — write `promoCode`, `promoPercentOff`, `discountedTotalCents`.
   - **flash wins:** write `promoPercentOff` + `discountedTotalCents` (via
     `discountedTotalCents()` from `promo-math.ts`) and a new **`discountLabel`**
     field; leave `promoCode` **unset**.
   - **none:** unchanged.

`promoCode` stays reserved for real redeemable codes so the redemption counter and any
code-keyed logic are never corrupted by a sale. The verify route's `promoApplies`
check (`src/app/api/reservations/verify/route.ts`, line ~58) is widened to
`(!!r.promoCode || !!r.discountLabel) && typeof r.discountedTotalCents === "number"`.

### Reservation record — `src/sanity/schemaTypes/reservation.ts` + `reservations.ts`

Add an optional `discountLabel: string` field to the reservation schema and the
`Reservation` type. It is display-only; existing promo fields keep their meaning.

### Online checkout — `src/app/api/checkout/route.ts` (lines ~121–182)

1. Same `resolveDiscount` against the active drop's flash status and any typed code.
2. Generalize `ensureFoundingCoupon(stripe, pct)` → **`ensurePercentCoupon(stripe, pct)`**
   (coupon id `pct-${pct}pct`, name `"${pct}% off"`; the founding flow keeps working —
   it is the same percent-keyed reusable-coupon pattern).
3. Apply the winning percent as the session-level discount exactly as today.
4. Metadata: record the discount source/label (`flash` vs the promo code) for the
   webhook/order log, preserving the existing `promo` metadata for real codes.

## 3. Storefront UI

### `FlashSaleBanner` — new client component

`⚡ {headline} — {percentOff}% off · ends in [Countdown to={endsAt} tone="acid"]`.
Reuses the existing `Countdown`. Renders nothing when `flashSaleStatus` is inactive.
Placed on:
- Home — `src/app/page.tsx`
- Menu — `src/app/menu/page.tsx`
- Cart — `src/app/cart/page.tsx`

The active flash state is computed server-side (server components already fetch the
drop) and passed to the banner; only the countdown ticks client-side, matching how
`Countdown` already avoids hydration mismatch.

### `SalePrice` — new component for struck-through prices

Shows `~~$12.00~~ $9.60` — original struck in `text-ink-500`, sale price in the
existing ochre price pill. Sale price computed with `discountedTotalCents` /
`discountCents` from `promo-math.ts` at the unit level. Wired into:
- `src/components/product-card.tsx` (the price pill, lines ~49–51)
- the product detail page (`src/app/product/[slug]/page.tsx`)

Components receive the active `percentOff` (0 = render the plain price unchanged) from
their server parents, so there is no client fetch and no flash of wrong price.

### Cart total

The cart already totals from `priceCents`. When a flash sale is active it shows the
discounted total with the original struck through, so the number matches the
reservation/checkout result — no surprise at the final step.

## 4. Edge cases

- **Auto-expiry:** at `endsAt` the countdown hits zero, `flashSaleStatus` flips to
  inactive at read time, prices revert, and the coupon stops applying — zero baker
  action, same model as drop open/close.
- **Gating:** a sale only applies while `effectiveDropStatus === "open"`; draft /
  announced / soldout / closed drops never discount.
- **Pre-launch:** covered because the reserve path applies the discount.
- **vs. founding/promo codes:** `resolveDiscount` enforces larger-wins, no stacking.
- **Misconfiguration:** `enabled` with no `endsAt` (or `endsAt` in the past) → inactive,
  fail-safe to full price. Studio validation prevents the enabled-without-`endsAt` case
  at authoring time.
- **Zero-config / seed mode:** seed drops have no `flashSale`; helper returns inactive,
  everything renders at full price.

## 5. Testing

- `src/lib/__tests__/flash-sale.test.ts` — window math (before/within/after), missing
  `startsAt`, missing/past `endsAt`, open-gating, inactive defaults.
- `src/lib/__tests__/resolve-discount.test.ts` — flash-only, promo-only, both
  (larger wins), tie → flash, neither → none, label set only for flash.
- Extend reserve/checkout reasoning tests where practical to assert the winning
  discount is the one persisted/applied.
- Existing promo and founding-coupon tests must keep passing (the founding flow is
  unchanged behavior, just renamed helper).

## Out of scope (future cycles)

- Scarcity nudges inline with sale prices (deferred from the "Full" UI option).
- Loyalty / rewards (next roadmap item).
- Corporate / B2B orders (third roadmap item).
- Email broadcast of a live sale (the Email-list build, not selected for now).

## Parked ideas (unrelated to flash sales — work on later)

- **Sourdough chocolate chip cookies** — add as a new product line / menu item
  (own product doc, photo, recipe + ingredient costing for the ROI calculator,
  and a slot in a drop's `lineItems`). A natural candidate for a flash sale or a
  loyalty reward once those ship. Revisit after the marketing roadmap
  (flash sales → loyalty → corporate) is done.
