# In-person sales & favors — design

**Date:** 2026-06-20
**Status:** Approved (pending written-spec review)

## Problem

The admin ROI calculator (`/admin/calculator?drop=…`) models each drop from
per-loaf lines that carry a **single sale price per loaf type**. Two real
situations don't fit:

1. **Mixed prices for the same loaf.** The baker sells one loaf for $12 and
   another (same loaf) for $10 as favors. The single `salePriceCents` per loaf
   line can't represent this — only a fudged blended average.
2. **In-person / cash sales.** Orders taken in person aren't in the system.
   Today the only knob is bumping a loaf line's "units," which applies the
   single sale price and never becomes a real order record.

The baker wants these captured as **real records** (with who bought) that flow
into the **bake list** and **"Actually collected,"** not just ROI math.

## Key insight

The existing **`reservation`** document already does almost everything needed:

- attaches to a drop,
- records the buyer (name/email/phone),
- holds **per-item `priceCents`** — so "$12 to one, $10 to another" is naturally
  representable as two records (or two lines) at two prices,
- when `status == "confirmed"` it **already** feeds `buildBakeListView` and the
  calculator's "Actually collected" total (`src/app/admin/calculator/page.tsx`).

What's missing is a way for the baker to **create** one by hand, and a relaxation
of the currently-required email/phone for a name-only cash sale.

## Decisions (from brainstorming)

- **Tracking depth:** full order record + who (not just money).
- **Buyer info:** **name only** required; email/phone optional.
- **Entry point:** the **`/admin/reservations`** page.
- **Approach:** **reuse the `reservation` type** (vs. a new `manualSale` type or
  a calculator-only price-tier feature). Reuses existing bake-list and
  "collected" wiring; minimal new surface.
- **Calculator favors:** **add** a new read-only "Favors given (actual)" metric;
  leave the existing editable per-loaf modeling table untouched.

## Design

### 1. Data model (`src/sanity/schemaTypes/reservation.ts`)

Add two optional fields; change nothing about existing online reservations:

- `channel`: string, `"online"` (default) | `"in-person"`. Distinguishes a
  hand-logged completed sale from a public pay-at-pickup request.
- Relax `customerEmail` and `customerPhone` validation from `.required()` to
  optional. (`customerEmail` keeps `.email()` *when present*.)

`items[].priceCents` is unchanged — it is where the per-buyer favor price lives.
The favor on any line is `product.listPrice − priceCents` (× quantity).

### 2. Creating the sale

**Mutation — `createInPersonSale` in `src/sanity/lib/mutations.ts`:**

- Writes a `reservation` with `status: "confirmed"`, `channel: "in-person"`,
  `createdAt = now`, `decidedAt = now`.
- `customerName` required; `customerEmail`/`customerPhone` written only when
  provided (no `.trim().toLowerCase()` on an absent email — the existing
  `createReservation` assumes a present email, so this is a separate function).
- `items`: `[{ productSlug, productName, quantity, priceCents }]`.
- `totalCents = Σ quantity × priceCents`.
- After create, calls **`decrementDropQuantities(dropId, items)`** so stock drops
  (same as confirming a normal reservation). Best-effort + logged on failure,
  mirroring `decideReservation`'s tradeoff comment.
- Returns the new doc id or `null` when `writeClient` is unconfigured.

**API route — `POST /api/admin/reservations/in-person/route.ts`:**

- `runtime = "nodejs"`, gated by `getAdminSession()` → 401 otherwise.
- Body: `{ dropId, customerName, customerEmail?, customerPhone?, items: [{productSlug, productName, quantity, priceCents}] }`.
- Validates: non-empty `dropId`, non-empty `customerName`, ≥1 item with
  `quantity ≥ 1` and `priceCents ≥ 0`. Coerces ints.
- Calls `createInPersonSale`; returns `{ ok: true }` or an error
  (`503` when saving isn't configured, matching `drop-financials`).

**Form component — on `/admin/reservations`:**

- New client component (e.g. `src/components/in-person-sale-form.tsx`).
- Fields: drop selector (drops list passed from the page), buyer **name**,
  optional email/phone, and a row per loaf in the selected drop with **qty**
  (default 0) and **price charged** (default = list price; editable down).
- Live **total** and a small **"favor: $X"** hint per line and overall.
- Submit → POST → on success refresh the list (server action / `router.refresh`).
- The page (`src/app/admin/reservations/page.tsx`) must now also load the
  selectable drops + each drop's line items (products with list prices) to seed
  the form. Reuse `getDropsView` / drop `lineItems` as the calculator page does.

### 3. Reuse (no new wiring)

A confirmed reservation already:

- shows in the **bake list** (`buildBakeListView` consumes confirmed
  reservations),
- counts in **"Actually collected"** on the calculator,
- lists on `/admin/reservations` (via `RESERVATIONS_QUERY`).

Add `channel` to `RESERVATIONS_QUERY` and render an **"in-person"** badge so
hand-logged sales are visually distinct from public pay-at-pickup requests.

### 4. Favors in the calculator (read-only, additive)

Add a new metric **"Favors given (actual)"** on `/admin/calculator`, computed
server-side from real per-item data over the drop's orders + reservations:

```
favorsActual = Σ over every order/reservation item:
                 max(0, listPrice(slug) − priceCents) × quantity
```

- `listPrice(slug)` comes from the drop's line items (already loaded).
- Displayed next to "Actually collected" as authoritative, real-money favors.
- The existing editable per-loaf table and its modeled "Favors / discounts
  given" metric are **unchanged** — they remain a what-if planning tool.

This is the answer to "where are my favors": they are entered at point of sale as
the per-item price, and totaled here from real records.

### 5. Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `reservation` schema | persist sale incl. `channel`, optional contact | Sanity |
| `createInPersonSale` | write confirmed in-person reservation + decrement stock | `writeClient`, `decrementDropQuantities` |
| `POST .../in-person` | auth + validate + call mutation | `getAdminSession`, mutation |
| in-person sale form | collect buyer + per-line qty/price, show favor/total | API route, drops+lineItems |
| favors-actual helper | pure `Σ (list − charged) × qty` over items | none (pure) |
| calculator page | render "Favors given (actual)" | helper, existing reads |

## Testing

- **Pure favor/total helper:** items + list prices → `{ totalCents, favorsCents }`;
  cover full-price, favor, and (clamped) above-list cases.
- **`createInPersonSale`:** doc shape (status/channel/optional contact), total
  computed, `decrementDropQuantities` called with the right items.
- **API route:** 401 unauthorized; 400 on missing name/dropId/items; happy path.
- **Calculator actual-favors aggregation:** mixed-price reservations across two
  buyers of the same loaf produce the correct total.

## Out of scope / non-goals

- No changes to the public reservation/checkout flow.
- No confirmation email for in-person sales (they're already complete).
- No change to the existing editable calculator modeling math.
- No new `manualSale` document type.

## Known-issue note

Per the deferred order→drop attribution issue, the bake list / public-orders
tally keys on stored `status == "confirmed"`/`"open"` rather than a time-aware
effective status. In-person sales are created already-`confirmed`, so they behave
consistently with that existing model; this design neither fixes nor worsens it.
