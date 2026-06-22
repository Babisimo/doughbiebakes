# Favor breakdown (who & what) on the calculator — design

**Date:** 2026-06-22
**Status:** Approved (pending written-spec review)

## Problem

The dashboard and calculator show *how much* was given away in favors
(`actualFavorsCents`), but never *who* got a favor or on *what* loaf. The
dashboard rolls up saved `dropFinancials` snapshots, which store only a favors
total — the per-buyer/per-item detail does not exist there. That detail lives in
the drop's live **orders** and **reservations**, each of which already carries
the buyer name and a per-item charged `priceCents`.

The baker wants to see, for a drop, the list of favors actually given: each
buyer, the loaf, and the amount.

## Decision (from brainstorming)

- **Location:** the **calculator** (`/admin/calculator?drop=…`), which already
  loads the selected drop's orders + reservations + list prices and computes the
  favors total. (Rejected: a dashboard drill-down — its snapshot rows lack the
  detail and would need separate per-drop live fetches that can diverge from the
  frozen total; and the bake list — operational, not financial.)
- **Approach:** a **pure `favorLines` helper** in `favors.ts` (mirrors how
  `actualFavorsCents` already works) + a **server-rendered section** on the
  calculator page. No changes to the large `calculator-client.tsx`.
- **Sources:** both **public orders and confirmed reservations** (including
  in-person/comped), so a self-comped loaf appears too.
- **Read-only.** No new data, no schema change, no dashboard change.

## Design

### 1. Pure helper (`src/lib/favors.ts`)

Add two types and one function. Cents in, cents out, no I/O — same module and
style as the existing `actualFavorsCents`.

```ts
export type FavorSource = {
  who: string;
  items: {
    productSlug: string;
    productName?: string;
    quantity: number;
    priceCents?: number;
  }[];
};

export type FavorLine = {
  who: string;
  productName: string;
  quantity: number;   // whole units, ≥ 1
  chargedCents: number; // per-unit price actually charged
  listCents: number;    // per-unit list price
  favorCents: number;   // line total given away = qty × (list − charged)
};

export function favorLines(
  sources: FavorSource[],
  listPriceBySlug: Map<string, number>,
): FavorLine[];
```

Rules (reuse the module's existing `intNonNeg`/`centsNonNeg` clamps):

- For each source, each item: skip when `priceCents` is not a number, when the
  slug has no list price in the map, or when the clamped quantity is `0`.
- `favorPerUnit = max(0, list − charged)`; `favorCents = qty × favorPerUnit`.
  Skip the line when `favorCents <= 0` (full-price and above-list items produce
  no line).
- `productName` = the item's `productName` when present, else the slug.
- Result sorted by `favorCents` **descending** (biggest giveaways first); ties
  keep input order (stable sort).

**Invariant:** `Σ favorLines(...).favorCents === actualFavorsCents(...)` for the
same sources + list map — the list and the existing total always agree. A test
asserts this.

### 2. Calculator page (`src/app/admin/calculator/page.tsx`)

The page already loads `orders` (`OrderSource[]`) and `reservations`
(`ReservationSource[]`) for the drop and builds `listBySlug`. Build
`FavorSource[]` from both:

```ts
const favorSources: FavorSource[] = [
  ...orders.map((o) => ({ who: o.customerName || "(no name)", items: o.items })),
  ...reservations.map((r) => ({ who: r.customerName || "(no name)", items: r.items })),
];
const favors = favorLines(favorSources, listBySlug);
```

`o.items`/`r.items` are `BakeListItem[]` (`productSlug`, `productName`,
`quantity`, optional `priceCents`) — structurally a `FavorSource["items"]`.

Render a new **server-side** section (a small local component or inline JSX),
placed after the `<ProfitabilityCalculator>` block, within the same container:

> **Favors given — who & what** · total $X
> Babo · 1× Lemon & Blueberry · **$12.00** given · charged $0.00 of $12.00 ea
> Maria · 1× Jalapeño Cheddar · **$2.00** given · charged $10.00 of $12.00 ea

- Header total = `Σ favors.favorCents` (formatted via `formatPrice`).
- When `favors.length === 0`, render a quiet "No favors given on this drop."
- Plain list/table; no interactivity. Favor amount emphasized (e.g.
  `text-flame-700`, matching the favor accent used elsewhere).

### 3. Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `favorLines` | pure: sources + list map → sorted favor lines | none |
| calculator page section | build sources, render the list | `favorLines`, existing reads, `formatPrice` |

## Testing

Unit-test `favorLines` (`src/lib/favors.test.ts`, the existing suite):

- Two buyers of the same loaf at different prices → two lines, correct
  `favorCents`, sorted descending.
- A full-price item → no line; an above-list item → no line.
- An item with unknown list price (slug absent from the map) → skipped.
- An item with missing `priceCents` → skipped.
- A `$0` charged price (comp) → one line with `favorCents == qty × list`.
- Cross-check: `Σ favorLines(...).favorCents === actualFavorsCents(...)` for a
  mixed input.

## Out of scope / non-goals

- No dashboard change (snapshots stay totals-only).
- No bake-list change.
- No new fields shown beyond who · loaf · qty · charged/list · favor (no
  fulfillment, date, or contact).
- No schema, query, or write changes — reuses the calculator's existing reads.
