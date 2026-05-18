# Combined Bake List — Design

**Date:** 2026-05-17
**Status:** Approved (pending user spec review)
**Sub-project:** B (follows sub-project A "persist public orders", shipped 2026-05-17)

## Problem

`/admin/club/[dropId]` currently shows only Bread Club **member** picks. The
"Tally per flavor" section explicitly excludes public orders ("check Stripe
Dashboard for those"). The baker has no single place that answers "how many of
each loaf do I bake for this drop?" across every obligation. With sub-project A,
public orders are now persisted as `order` documents, so the data exists to
combine all three pick sources.

## Goal

Expand the bake list to show **every pick** for the active drop — Bread Club
members + paid public orders + confirmed reservations — with one combined
"bake N of each loaf" tally plus a per-source roster for contact/fulfillment.

## The three pick sources

| Source | Sanity type | Shape | Contact info | Counts toward bake |
|---|---|---|---|---|
| Member selections | `memberSelection` | 1 loaf each, `fulfillment` pickup/ship; synthetic "default" picks for members who never chose | Not embedded — page does a per-member Stripe customer lookup | Yes, 1 per member (incl. defaults) |
| Public orders | `order` | Multi-item w/ quantities, `fulfillment` pickup/ship, `livemode` flag | Embedded (name/phone/shipAddress) | Yes, **livemode == true only**, sum quantities |
| Reservations | `reservation` | Multi-item w/ quantities, pickup-only (reserve & pay at pickup), `status` pending/confirmed/declined | Embedded (name/phone) | Yes, **status == "confirmed" only**, sum quantities |

All three reference a drop via `drop._ref`, so each is queryable per-drop.

## Decisions (locked with user)

1. **Layout:** one combined Bake-totals card at the top, then three separate
   roster sections (Members / Public orders / Confirmed reservations). The
   existing Members table is preserved as-is. The old member-only "Tally per
   flavor" section and its Stripe-dashboard disclaimer are removed (superseded).
2. **Test orders:** **live orders only.** `order` docs with `livemode == false`
   are hidden entirely — never shown, never tallied.
3. **Reservations:** confirmed only count. Pending reservations are surfaced as
   a small heads-up note ("N pending — review at /admin/reservations"), not as
   roster rows and not in the tally.
4. **No cross-source dedup:** the same email appearing as a member *and* a
   public order *and* a reservation is three distinct obligations — each shows
   in its own section and each adds to the tally.

## Architecture

```
/admin/club/[dropId]/page.tsx  (thin server component — unchanged guards)
  ├─ getActiveDrop({fresh})                          ── existing
  ├─ getMemberSelectionsForDrop(drop,{fresh})        ── existing (incl. "default" synthesis)
  ├─ getLiveOrdersForDrop(dropId,{fresh})            ── NEW catalog fn
  ├─ getConfirmedReservationsForDrop(dropId,{fresh}) ── NEW catalog fn
  ├─ getPendingReservationCountForDrop(dropId,{fresh}) ── NEW catalog fn (count only)
  ├─ Stripe per-member contact enrichment            ── existing, unchanged
  └─ buildBakeListView({drop, members, orders, reservations, pendingReservationCount})  ── NEW pure module
         └─ returns BakeListView
```

- **Approach chosen:** pure aggregation module + thin page. Matches the
  codebase's strongest convention (`order-record.ts`, `reservation-eval.ts`,
  `drop-status.ts` are all pure-logic modules unit-tested with `node:test`).
  Rejected: inline-in-page (untestable, page already overloaded) and a single
  union GROQ query (can't express member "default" synthesis or Stripe
  enrichment; not unit-testable).
- New GROQ queries live in `src/sanity/lib/queries.ts`; new fetch wrappers in
  `src/lib/catalog.ts`, using the same `fresh` / `cache:"no-store"` / non-CDN
  pattern as the existing catalog reads.
- `src/lib/bake-list.ts` is pure: no I/O, no `server-only`. The Stripe
  per-member contact lookup stays in the page (I/O) and is merged onto member
  rows for *display only* — it never feeds the tally.

## Data flow & tally rule

- Member pick → +1 toward its `productSlug` (including synthetic `source:"default"` picks — preserves current behavior).
- Order item → +`quantity` toward its slug (live orders only).
- Confirmed reservation item → +`quantity` toward its slug.
- `totals` lists every slug seen across all three sources: drop line-items
  first (in drop order), then any extra slug last, tagged `inDrop:false`, so the
  baker never silently under-bakes when a product was removed from the drop
  after an order/reservation was placed.

## Type contract — `src/lib/bake-list.ts`

```ts
export type BakeTotal = { slug: string; name: string; count: number; inDrop: boolean };

export type BakeMemberRow = {
  email: string; slug: string; productName: string;
  source: "explicit" | "default"; fulfillment: "pickup" | "ship";
};
// NOTE: members have no person-name here — that is the page's Stripe lookup.
// `productName` is the chosen flavor (drop line-item name → slug fallback).
// Order/reservation rows DO carry `name` (the person) since those docs are
// self-contained. The field meanings are intentionally different per source.

export type BakeOrderShipAddress = {
  line1?: string; line2?: string; city?: string; state?: string; postalCode?: string;
};

export type BakeOrderRow = {
  email: string; name: string | null; phone: string | null;
  items: { slug: string; name: string; qty: number }[];
  fulfillment: "pickup" | "ship";
  shipAddress: BakeOrderShipAddress | null;
  totalCents: number;
};

export type BakeReservationRow = {
  email: string; name: string; phone: string;
  items: { slug: string; name: string; qty: number }[];
  totalCents: number;
};

export type BakeListInput = {
  drop: { lineItems: { product: { slug: string; name: string } }[] };
  members: { customerEmail: string; productSlug: string;
             fulfillment: "pickup" | "ship"; source: "explicit" | "default" }[];
  orders: { customerEmail: string; customerName?: string | null;
            customerPhone?: string | null;
            items: { productSlug: string; productName: string; quantity: number }[];
            fulfillment: "pickup" | "ship";
            shipAddress?: BakeOrderShipAddress | null; totalCents: number }[];
  reservations: { customerEmail: string; customerName: string;
                  customerPhone: string;
                  items: { productSlug: string; productName: string; quantity: number }[];
                  totalCents: number }[];
  pendingReservationCount: number;
};

export type BakeListView = {
  totals: BakeTotal[];
  members: BakeMemberRow[];
  orders: BakeOrderRow[];
  reservations: BakeReservationRow[];
  pendingReservationCount: number;
  counts: { members: number; orders: number; reservations: number; loaves: number };
};

export function buildBakeListView(input: BakeListInput): BakeListView;
```

- `BakeMemberRow.productName` is the chosen flavor (drop line-item name → slug
  fallback). The member's person-name/phone/address is layered on by the page
  via the existing Stripe lookup after `buildBakeListView`, so the pure module
  needs no Stripe types and carries no member person-name.
- `name` resolution for tally/items: drop line-item name → stored
  `productName` → slug, in that order.
- Item with `quantity <= 0` or non-integer: `Math.floor`, drop if `< 1`
  (mirrors the shipped `buildOrderRecord` hardening).

## Rendering (replaces current page body; auth/notFound guards unchanged)

1. **Bake totals** card — `name … count`, drop line-items first; any extra slug
   shown last with a "not in this drop" tag.
2. **Members (N)** — the existing table, unchanged.
3. **Public orders (N)** — name · email · phone · items (`3× Classic`) · via ·
   address (or "pickup — no address needed").
4. **Confirmed reservations (N)** — name · email · phone · items · total due at
   pickup. When `pendingReservationCount > 0`, a note above the section:
   "N pending reservation(s) not counted — review at /admin/reservations".
5. Empty-everything → a generalized "Nobody's picked yet" empty state.

## Error handling & edge cases

- **Sanity unconfigured (demo mode):** new catalog fns return `[]` (same guard
  as siblings). Bake list shows member/seed data only — no crash.
- **A new fetch throws:** degrade that source to `[]` with
  `console.error("[admin/club] <source> fetch failed", err)`; the rest of the
  bake list still renders (mirrors the page's tolerant Stripe `try/catch`).
- **Order with `drop == null`:** not attributable to any per-drop bake list.
  Known limitation; mitigation is the Stripe dashboard. Rare (only when no drop
  is open at checkout).
- **Slug not in drop line items:** still summed, `inDrop:false`, "not in this
  drop" tag, name from stored `productName`.
- **`qty <= 0` / non-integer:** floored, dropped if `< 1`.
- **Same email across sources:** intentionally not deduped.

## Testing

`src/lib/__tests__/bake-list.test.ts` — `node:test`, pure `buildBakeListView`:

1. Combined tally sums across all three sources correctly (counts.loaves too).
2. Quantities not row counts (`4× Rosemary` → 4).
3. Synthetic `source:"default"` member picks still add 1.
4. Slug not in drop line items → `inDrop:false`, name from `productName`,
   ordered after drop line-items.
5. `qty:0` and `qty:2.5` → contribute 0 and 2.
6. Empty sources → empty `totals`, zeroed `counts`, `pendingReservationCount`
   passed through untouched.
7. No dedup — same email as member + order → both rows, both counted.

No tests for the page component, GROQ queries, or Stripe enrichment (I/O —
consistent with the codebase testing pure logic only). New catalog wrappers
follow an already-proven pattern, not independently unit-tested (same as
siblings).

## Out of scope

- Historical / previous-drop bake lists (this is the active drop only, as today).
- Reconciling orphan orders (`drop == null`) into a drop.
- Any change to how orders/reservations/selections are *written*.
