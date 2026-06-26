# Handoff — pending work

Running list of known-but-deferred work. Each item: what, why it matters, where,
how to fix, and current status. Remove an item when it's done.

---

## 1. `order` reads use the tokenless client — will miss paid orders once live

**Status:** PENDING (deferred 2026-06-20 — safe to defer while prelaunch).

**What:** `getLiveOrdersForDrop` (and any other read of `order` docs) goes through
the public, tokenless Sanity client (`fetchSanity` in `src/lib/catalog.ts`). The
dataset restricts some sensitive types from unauthenticated reads. `dropFinancials`
was confirmed restricted; `order` is very likely restricted too (it was empty at
check time, so unconfirmed). Reservations are public, so the bake list currently
works off reservations.

**Why it matters:** The store is **prelaunch** with **0 Stripe orders**, so nothing
breaks today. Once you flip to `live` and take card payments, paid `order` docs
may be invisible to the bake list / "Actually collected" / financials — the same
class of bug that hid the dashboard.

**Where:** `src/lib/catalog.ts` → `getLiveOrdersForDrop` (uses `fetchSanity`).
Compare with the already-fixed `getAllDropFinancials` / `getDropFinancials`, which
use the server-only `authedClient` + `fetchAuthed()` in the same file.

**How to fix:** Route `getLiveOrdersForDrop` (and any other admin/server `order`
read) through `fetchAuthed()` instead of `fetchSanity`. First confirm the
restriction once an order exists: tokenless vs token `count(*[_type=="order"])`.

**Verify:** with a real (or seeded) live order, the bake list and the calculator's
"Actually collected" include it.

---

## 2. `reservation` docs are publicly readable — customer PII exposure

**Status:** PENDING (deferred 2026-06-20).

**What:** `reservation` documents are readable via the public/tokenless Sanity API
(confirmed: tokenless `count(*[_type=="reservation"])` returned all docs). Each
reservation holds `customerName`, `customerEmail`, `customerPhone`.

**Why it matters:** Anyone with the project id can read customer PII through the
public Content Lake API. The storefront genuinely needs *some* reservation read
for availability (pending reservations hold stock — see
`PENDING_RESERVATION_ITEMS_FOR_DROP_QUERY`), but it does NOT need to expose the
contact fields publicly.

**Where:** Sanity dataset read access (project `91s54g5t/production`) +
`src/sanity/lib/queries.ts` reservation queries. App read client has no token
(`src/sanity/client.ts`).

**How to fix (options):**
- Tighten the dataset so `reservation` requires a token, then move admin
  reservation reads to a token-bearing client (like the financials fix). Keep the
  public availability read limited to non-PII fields, or compute stock holds via a
  server route.
- Or restructure so the public availability check doesn't read reservation PII at
  all (e.g., a derived stock-hold field on the drop).

**Verify:** tokenless query for reservations returns no PII (or nothing);
admin reservation list still works; public availability/stock holds still correct.

---

## 3. Online discounted reservations over-count "Actually collected"

**Status:** PENDING (logged 2026-06-26).

**What:** A reservation made with a flash sale or promo stores `totalCents` = the
**full** subtotal and `discountedTotalCents` = the discounted amount, but
**never sets `collectedCents`** (see `createReservation` in
`src/sanity/lib/mutations.ts`). The calculator's "Actually collected" uses
`reservationCollectedCents(r)` = `collectedCents ?? totalCents`
(`src/lib/favors.ts`) and **ignores `discountedTotalCents`**. So every discounted
**online** reservation is counted at full price — over-stating collected revenue
by the discount.

**Why it matters:** With the Fourth of July flash sale live, online reservations
booked at −15% still tally as full price in the calculator's "Actually collected"
and any rollup built on it. Understated discounts inflate revenue.

**Where:** `createReservation` (sets no `collectedCents`) +
`getConfirmedReservationsForDrop` in `src/lib/catalog.ts` (doesn't read
`discountedTotalCents`) + `reservationCollectedCents` in `src/lib/favors.ts`.

**Note:** The **in-person** path is correct by construction (Model B, see #4):
the sale price is baked into the per-line prices, so `totalCents` already equals
what's collected (`collectedCents` stays unset and falls back to it). This bug is
online-only.

**How to fix (options):**
- Set `collectedCents` to `discountedTotalCents` when a discount applies, at
  reservation-create time (mirrors the in-person path). Simplest, consistent.
- Or make `reservationCollectedCents` prefer `discountedTotalCents` when present
  and no explicit `collectedCents` override exists (centralizes the rule).

**Verify:** with a discounted online reservation, the calculator's "Actually
collected" reflects the discounted amount, not full price.

---

## 4. In-person and online flash-sale pricing use two different models

**Status:** NOTE — shipped, intentional divergence (logged 2026-06-26).

**What:** As of the "Model B" change, **in-person** sales bake the sale price into
each per-line `priceCents` (`totalCents` = Σ charged = collected; `promoPercentOff`
stored only for context + the favor baseline; **no** `discountedTotalCents`). A
favor is anything charged below the sale price. **Online** reservations still use
**discount-on-total**: `totalCents` = full subtotal, `discountedTotalCents` = the
discounted amount, line items stored at list.

**Why it matters:** There are now two shapes for "a discounted reservation."
- Admin list (`src/app/admin/reservations/page.tsx`) renders them differently:
  in-person shows total + a "Flash Sale −N%" badge; online shows a struck-through
  discounted total.
- Favor reports value in-person favors at the sale price via `promoPercentOff`
  (`effectiveListCents` in `src/lib/favors.ts`); online lines sit at list so they
  naturally show $0 favor.
- Anyone extending discount/favor logic must handle both shapes. **Unifying online
  onto Model B would also resolve #3.**

**Where:** in-person create/amend routes + `effectiveListCents`/`favorLines`/
`actualFavorsCents` in `src/lib/favors.ts`; online reserve route + `createReservation`.

**Design:** `docs/superpowers/specs/2026-06-26-favor-baseline-flash-sale-design.md`.
A one-time migration (`scripts/migrate-favor-baseline.mjs`) already converted the two
pre-existing in-person flash-sale records (Victoria, Erin) to Model B.

---

See also project memory: `sanity-restricted-read-types`,
`known-issue-order-drop-attribution`, `flash-sale-fast-follows`.
