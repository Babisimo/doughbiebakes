# Favors during a flash sale — sale price as the per-loaf baseline (Model B)

**Date:** 2026-06-26
**Status:** Approved

## Problem

When a flash sale is live, an in-person favor is valued against the **full list
price**, not the sale price. A free loaf during the 15%-off sale records a favor of
$12.00 when it should be $10.20 (the going price everyone else pays). The earlier
"discount on the total" model also double-discounts a reduced-but-nonzero favor
(charge $8 during a 15% sale → collected $6.80).

## Decision (Model B)

During an active flash sale, each loaf's **effective price** is the sale price
(`list − percentOff%`). The baker charges that by default; a **favor** is anything
charged below it; the **total** is simply Σ(charged) — no separate discount on the
total. This supersedes the in-person "discount on the total" mechanism.

## Changes

### Pure logic — `src/lib/favors.ts`
- New exported `effectiveListCents(listCents, promoPercentOff)` = `list − pct%`
  (via `discountedTotalCents`), or `list` when no sale.
- `actualFavorsCents` and `favorLines`: each source carries an optional
  `promoPercentOff`; the favor baseline becomes `effectiveListCents(list, pct)`.
  Sources without a percent (orders, non-sale reservations) are unchanged.
- **Remove** `computeInPersonSale` and `recomputeAmendedSale` (the discount-on-total
  helpers) and their tests — superseded by per-line sale pricing.

### Sale form — `src/components/in-person-sale-form.tsx`
- "Price each" defaults to the sale price; "List" shows the original (struck through
  when a sale is live). Favor = `salePrice − charged`. Total = Σ(charged).
- A "Flash Sale −N%" badge for context. No discount-on-total line.

### In-person route — `.../in-person/route.ts`
- `totalCents` = Σ(charged). Store `promoPercentOff` + `discountLabel` for
  context/audit and the calculator baseline. No `discountedTotalCents`,
  no `collectedCents` (totalCents already reflects the sale).

### Amend — `.../[id]/amend/route.ts` + `reservation-amend.tsx`
- In-person amend: `totalCents` = Σ(charged), keep the stored `promoPercentOff`,
  unset any legacy `discountedTotalCents`. Favor baseline = sale price.
- Form: favor uses the sale-price baseline; "Total due" = Σ(charged) (drop the
  discount-on-total display).

### Favor reports wiring
- `ReservationSource` (`src/lib/bake-list.ts`) gains `promoPercentOff?`;
  `CONFIRMED_RESERVATIONS_FOR_DROP_QUERY` selects it;
  `getConfirmedReservationsForDrop` maps it.
- Calculator (`src/app/admin/calculator/page.tsx`): pass `promoPercentOff` on each
  reservation favor source. Orders keep the list baseline (out of scope).

### Admin list — `src/app/admin/reservations/page.tsx`
- For an in-person flash sale, show a "Flash Sale −N%" badge next to the (already
  sale-adjusted) total instead of a strikethrough.

## Data migration (one-time, 2 records)

- **Victoria** (free favor, `promoPercentOff: null`): set `promoPercentOff: 15` so her
  favor reads $10.20. Line ($0) and total ($0) unchanged.
- **Erin** (old format: line $12, `discountedTotalCents`/`collectedCents` $10.20):
  reprice line to $10.20, `totalCents` 1020, unset `discountedTotalCents` +
  `collectedCents`, keep `promoPercentOff: 15`. Brings her to Model B so a future
  amend stays correct.

A short read-only-then-write script; run once.

## Out of scope (YAGNI)

- Stripe **orders** keep the list baseline (no in-person favors there).
- Online reservation discount display is unchanged (still discount-on-total).

## Verification

- Unit tests: `effectiveListCents`; `actualFavorsCents`/`favorLines` with a
  `promoPercentOff` (free favor → sale price; non-favor at sale price → 0).
- `npm test`, `npm run typecheck`, `eslint` clean.
- Read-only check: Victoria's favor computes to $10.20 with the baseline.
