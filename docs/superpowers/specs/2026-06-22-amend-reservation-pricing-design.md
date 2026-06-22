# Amend reservation pricing & collected amount — design

**Date:** 2026-06-22
**Status:** Approved (pending written-spec review)

## Problem

A confirmed reservation's money is fixed at creation: each item's `priceCents`
sums to `totalCents`, and that total is what the calculator counts as "Actually
collected." Two real situations have no in-app fix today:

1. **A loaf reserved for yourself / fully comped.** The baker reserves a loaf
   through the normal flow ("like I was buying it"), so it lands at full list
   price and counts as revenue. There's no way to set it to $0 short of editing
   raw fields in Sanity Studio (where it's easy to leave `totalCents`
   inconsistent with the items — exactly what produced a $12 loaf that should
   have been $0).
2. **Different pay taken at delivery.** The baker sometimes collects a different
   amount than the reservation said — a discount given at the door, a partial
   payment, a rounded cash amount. Nothing records "what actually came in"
   separately from "what was reserved."

Both are the same missing capability: **amend a confirmed reservation after the
fact** — its per-loaf prices and/or the actual amount collected.

## Key insight

The favors model already keys everything off per-item `priceCents`
(`src/lib/favors.ts`): a favor is `max(0, listPrice − priceCents) × qty`, and
`totalCents = Σ priceCents × qty`. So **editing item prices** already expresses
discounts, comps, and own-bread ($0) correctly and keeps favors accurate — we
just need a way to do it after creation. The only genuinely new concept is a
**collected amount that can differ from the charged total**, which is one
optional field.

## Decisions

- **Surface:** custom *Edit* affordance on each reservation row at
  `/admin/reservations` (not Studio-only — Studio has no favor hints, no
  list-price reference, and forces manual `totalCents` recompute).
- **Editable:** per-loaf **prices** + an **actually-collected** override. NOT
  quantities (keeps stock-decrement out of scope), NOT buyer info, NOT
  pending/online pre-decision reservations.
- **Favors stay strictly per-loaf.** A collected amount below the charged total
  shows as informational ("collected less than due"); it does **not** add to the
  favors total. (Resolved: semantic question (a).)
- **Own-bread at $0 still counts as a favor** of the full list price (foregone
  revenue). No "own use" exclusion flag for now — reversible future addition.
  (Resolved: semantic question (b).)
- **Reuse the `reservation` type.** No new document type, no emails.

## Design

### 1. Data model (`src/sanity/schemaTypes/reservation.ts`)

Add one optional field; everything existing is unchanged:

- `collectedCents`: number, integer, `min(0)`, optional. The actual money taken
  in. **Absent ⇒ collected falls back to `totalCents`** (so every existing
  reservation reads identically to today).

Per-item `priceCents` is unchanged — it remains the source of truth for
`totalCents` and favors.

### 2. Pure recompute helper (`src/lib/favors.ts` or reservation-eval)

Reuse the existing `computeSaleTotals(items)` (already returns
`{ totalCents, favorsCents }`) to recompute `totalCents` from amended item
prices. No new math is required for favors/total; only the optional
`collectedCents` is carried through untouched.

### 3. Mutation (`src/sanity/lib/mutations.ts`)

**`updateReservationPricing(id, { items?, collectedCents? })`:**

- Loads nothing it doesn't need; patches the reservation doc:
  - When `items` provided: overwrite `items` (each `{ _type: "reservationItem",
    productSlug, productName, quantity, priceCents }` — quantities preserved
    from the input verbatim, never changed by this call) and set
    `totalCents = Σ priceCents × quantity`.
  - When `collectedCents` provided (number): `set` it. When explicitly cleared
    (e.g. `null`): `unset(["collectedCents"])` so it reverts to `totalCents`.
- Items carry **no array `_key`** today (confirmed against live data), so the
  patch rewrites the whole `items` array rather than targeting keys — matching
  how `scripts/zero-reservation.mjs` already does it.
- Does **not** touch stock (quantities are immutable here), status, or buyer
  fields.
- Returns `true` on success, `false` when `writeClient` is unconfigured.

### 4. API route (`src/app/api/admin/reservations/[id]/amend/route.ts`)

- `runtime = "nodejs"`, gated by `getAdminSession()` → 401 otherwise.
- Body: `{ items?: [{ productSlug, productName, quantity, priceCents }],
  collectedCents?: number | null }`.
- Validates: when `items` present, ≥1 item, each `quantity ≥ 1` (echoed, not
  changed) and `priceCents ≥ 0` integer; when `collectedCents` present, integer
  `≥ 0` or `null`. Coerces ints.
- Calls `updateReservationPricing`; returns `{ ok: true }`, or `503` when saving
  isn't configured (matching the in-person route / drop-financials).

### 5. UI — amend control on `/admin/reservations`

A new client component (e.g. `src/components/reservation-amend.tsx`), shown on
each **confirmed** reservation row:

- Collapsed: an *Edit prices* button.
- Expanded: one row per item with a **price charged** input (seeded from current
  `priceCents`), a live **"favor: $X"** hint per line computed against the
  drop's list price, an **Actually collected** input (seeded from the live
  recomputed total; leaving it equal to the total means "no override"), and a
  live **total / favors / collected** summary.
- The page already loads `saleDrops` (drop line items with list prices) for the
  in-person form — reuse that to supply list prices for the favor hints; match
  the reservation's `dropTitle`/drop id to the right drop's lines.
- Submit → `POST /api/admin/reservations/[id]/amend` → on success
  `router.refresh()`.

### 6. Calculator wiring (`src/app/admin/calculator/page.tsx`)

- Add `collectedCents` to the reservation read used here (and to
  `RESERVATIONS_QUERY` for the admin list display).
- Change the reservations term of `actualCollectedCents` from `r.totalCents` to
  `r.collectedCents ?? r.totalCents`. Orders and member charges unchanged.
- `actualFavorsCents` is unchanged (per-item) — a collected override never
  affects favors.

### 7. Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `reservation` schema | add optional `collectedCents` | Sanity |
| `computeSaleTotals` (existing) | items → `{ totalCents, favorsCents }` | none (pure) |
| `updateReservationPricing` | patch item prices + total + collected | `writeClient` |
| `POST .../[id]/amend` | auth + validate + call mutation | `getAdminSession`, mutation |
| amend control | edit prices/collected, show favor/total/collected | API route, drops+lineItems |
| calculator page | collected = `collectedCents ?? totalCents` | existing reads |

## Testing

- **`computeSaleTotals`** already tested; add a case asserting amended prices
  (incl. $0) produce the expected total + favor.
- **`updateReservationPricing`:** patch shape — `totalCents` recomputed from
  amended items; `collectedCents` set when provided and unset when cleared;
  stock/status/buyer untouched.
- **API route:** 401 unauthorized; 400 on bad items / negative cents /
  non-integer collected; happy path (prices only, collected only, both).
- **Calculator collected aggregation:** a reservation with `collectedCents`
  contributes the override, not `totalCents`; one without contributes
  `totalCents`; favors identical in both cases.

## Out of scope / non-goals

- Editing **quantities** (would require stock re-decrement) — delete + recreate
  instead.
- Editing buyer name/email/phone.
- Amending **pending/online** reservations before the baker decides them.
- Any "own use / not a favor" exclusion flag (deferred; reversible later).
- Emails, new document types, public-flow changes.

## Known-issue note

Per the deferred order→drop attribution issue, the bake list / collected tally
keys on stored `status == "confirmed"`. Amending an already-confirmed
reservation's prices doesn't change its status, so it stays consistent with that
model; this design neither fixes nor worsens it.
