# Edit in-person sale quantity — design

**Date:** 2026-06-26
**Status:** Approved

## Problem

An admin recording an in-person sale can mis-enter the quantity (e.g. logged 2× for
Erin Lomeli, should have been 1×). The "Edit prices" amend form shows for confirmed
reservations (in-person sales are `status: "confirmed"`), but quantity is **read-only**
and the amend path **never touches drop stock**. There is no way to correct a quantity.

## Goal

Let an admin edit the **quantity** of an **in-person** sale after the fact, with the
drop's remaining stock and any flash-sale discount kept correct.

## Scope decisions (confirmed)

- **In-person only.** Quantity becomes editable only when `channel === "in-person"`.
  Online reservations keep price-only editing (changing their quantity is riskier —
  the customer was emailed / may have paid).
- **Auto-reconcile stock, best-effort.** Changing a quantity adjusts the drop's
  remaining stock by the delta (returns freed loaves, takes added ones). Best-effort:
  a stock failure does not block the edit (mirrors the in-person sale-create path).

## Out of scope (YAGNI)

- Removing a line entirely (quantity 0) — quantity stays `>= 1`.
- Voiding a whole sale.
- Un-setting a `soldout` drop status when stock is returned (don't touch drop status).

## Design

### 1. UI — `src/components/reservation-amend.tsx`

New props:
- `canEditQuantity: boolean` — `true` only for in-person (page passes `r.channel === "in-person"`).
- `promoPercentOff?: number`, `discountLabel?: string` — the stored flash-sale discount.

Behavior:
- Quantity per slug becomes editable state (like prices). When `canEditQuantity`, render a
  number input (`min 1`); otherwise the read-only `2×` cell (online, unchanged).
- The full subtotal is recomputed from edited quantity × price. When `promoPercentOff` is
  present, "Total due" and the default "Actually collected" show the **discounted** total
  (`discountedTotalCents(full, promoPercentOff)`), recomputing live, with the full total
  struck-through plus the label. No discount → current behavior unchanged.
- Payload sends edited quantities and the collected amount.

### 2. Server — `src/app/api/admin/reservations/[id]/amend/route.ts`

For **in-person** reservations only:
- Fetch the reservation's `channel`, `dropId`, `promoPercentOff`, and **old items** (to diff stock).
- Recompute `totalCents` (full) from new items; recompute `discountedTotalCents` from the
  stored `promoPercentOff`; set `collectedCents` to the discounted total (or the baker's
  explicit override).
- Reconcile stock via a new best-effort mutation (see below).

Online reservations keep the exact current price-only path (no stock, no discount recompute).

### 3. Mutations — `src/sanity/lib/mutations.ts`

- Extend `updateReservationPricing` to also set/unset `discountedTotalCents`.
- New `adjustDropStock(dropId, deltas)`: applies a signed per-loaf delta
  (`newQty − oldQty`, i.e. additional units taken; negative returns stock),
  `next = max(0, current − delta)`. Does **not** change drop status. Best-effort
  (caller wraps in try/catch and logs a greppable signal on failure).

### 4. Pure, tested helpers — `src/lib/favors.ts`

- `recomputeAmendedSale(items, promoPercentOff)` → `{ totalCents, discountedTotalCents?, collectedCents? }`
  (reuses `computeSaleTotals` + `discountedTotalCents`; mirrors `computeInPersonSale`).
- A pure stock-delta function (old items vs new items → `{ slug, delta }[]`).

Both unit-tested, matching the repo convention of testing pure cents-in/cents-out logic.

## Worked example (Erin Lomeli)

Before: `2× Pepperoni @ $12`, `totalCents 2400`, `promoPercentOff 15`,
`discountedTotalCents 2040`, `collectedCents 2040`, Fourth of July Drop.

Edit 2 → 1:
- `totalCents 1200`, `discountedTotalCents 1020`, `collectedCents 1020`.
- 1 Pepperoni Sourdough returned to the Fourth of July Drop's stock.

## Verification

- Unit tests for `recomputeAmendedSale` and the stock-delta helper (incl. Erin's numbers).
- `npm test`, `npm run typecheck`, `eslint` clean.
- Manual: edit Erin 2→1 in `/admin/reservations`; confirm the row shows `$10.20 / ~~$12.00~~`
  and the drop's Pepperoni stock is back up by 1.
