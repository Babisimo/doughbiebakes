# Auto open/close drops + "Previous drops" — Design

Date: 2026-05-17
Status: Approved (pending written-spec review)

## Problem

Drop buyability is decided solely by the stored `status` field on the `drop`
document (`src/lib/availability.ts` — `const open = drop.status === "open"`).
The `ordersOpenAt` / `ordersCloseAt` datetimes exist and are fetched, but
nothing ever compares them to the current time. Consequences:

- A drop whose order window has ended still shows "add to order" until the
  baker manually flips the status in Sanity Studio.
- An `announced` ("coming soon") drop does not become buyable when its
  `ordersOpenAt` arrives — again a manual flip.

The baker wants this automated, and wants ended drops to remain visible as a
small "Previous drops" showcase (FOMO + range), not just vanish.

## Goals

1. Derive an **effective status** at read time from the stored status + the two
   datetimes + now. No cron, no background writes.
2. Auto-open `announced` drops at `ordersOpenAt`; auto-close `open`/`soldout`
   drops at `ordersCloseAt`.
3. A "Previous drops" section on the home page showing the **2** most
   recently-ended drops, with their loaves (unbuyable), reusing the existing
   product-card look.
4. Fully backward-compatible: a drop with no dates behaves exactly as today
   (manual). Demo/zero-config mode still showcases every state.

## Non-goals

- No scheduled job rewriting the stored status (explicitly rejected — fights
  the project's zero-config design, adds infra, races the webhook).
- No `/admin` change to surface the effective status (possible future
  follow-up, out of scope).
- No new product/drop CMS fields.

## Effective status model

Pure function `effectiveDropStatus(drop: Drop, now: Date): DropStatus`.
Precedence, top to bottom (first match wins):

| Stored      | Condition                                   | Effective   |
|-------------|---------------------------------------------|-------------|
| `draft`     | —                                           | `draft`     |
| `closed`    | —                                           | `closed`    |
| `soldout`   | `ordersCloseAt` set & `now ≥ ordersCloseAt` | `closed`    |
| `soldout`   | else                                        | `soldout`   |
| `open`      | `ordersCloseAt` set & `now ≥ ordersCloseAt` | `closed`    |
| `open`      | `ordersOpenAt` set & `now < ordersOpenAt`   | `announced` |
| `open`      | else                                        | `open`      |
| `announced` | `ordersCloseAt` set & `now ≥ ordersCloseAt` | `closed`    |
| `announced` | `ordersOpenAt` set & `now ≥ ordersOpenAt`   | `open`      |
| `announced` | else                                        | `announced` |

Notes:

- **Dates are opt-in automation.** If `ordersCloseAt` is unset, an
  `open`/`soldout` drop never auto-closes. If `ordersOpenAt` is unset, an
  `announced` drop never auto-opens. A dateless drop == today's manual
  behavior. This is the backward-compat guarantee.
- All comparisons use `Date.getTime()` (UTC ms); server timezone is irrelevant.
- The bundled seed/demo drop (`status: "open"`, open = now−2d, close = now+2d)
  remains effectively `open`.

Derived predicates (same file):

- `isCurrentDrop(drop, now)` → effective ∈ {`announced`, `open`, `soldout`}
- `isPreviousDrop(drop, now)` → effective === `closed`
- `dropRecencyKey(drop): number` → ms of `ordersCloseAt ?? pickupOrShipDate ??
  createdAt`, used to sort "most recent" consistently in JS and to mirror the
  GROQ ordering. Requires `createdAt` to be available on the `Drop` object
  (see Data layer — `DROP_FIELDS` and the `Drop` type both gain it).

`draft` is neither current nor previous (excluded from public queries).

## Data layer

Replace the single-result `ACTIVE_DROP_QUERY` with a bounded list query:

```
RECENT_DROPS_QUERY =
  *[_type == "drop" && status != "draft"]
    | order(coalesce(ordersCloseAt, pickupOrShipDate, _createdAt) desc)
    [0...8] { <DROP_FIELDS> }
```

8 is safe headroom (a Cottage Food bakery runs few drops) to always find 1
current + 2 previous even with irregular data.

`DROP_FIELDS` gains `"createdAt": _createdAt` and the `Drop` type
(`src/lib/types.ts`) gains `createdAt?: string`, so `dropRecencyKey` has a
final fallback for drops with neither `ordersCloseAt` nor `pickupOrShipDate`
(e.g. a manually-`closed` dateless drop). The GROQ `coalesce(...)` ordering
uses the raw `_createdAt` system field directly.

`src/lib/catalog.ts`:

- Internal `getRecentDrops(opts)` — fetches + normalizes the list (same
  normalize/line-item filtering as today's `getActiveDrop`).
- `getDropsView(): Promise<{ current: Drop | null; previous: Drop[] }>` — used
  by the home page. One fetch, one split:
  - `current` = first drop where `isCurrentDrop`; if none and Sanity is
    unconfigured/empty, fall back to `seedDrop()` (today's behavior).
  - `previous` = drops where `isPreviousDrop`, sorted by `dropRecencyKey`
    desc, capped at 2; if Sanity unconfigured/empty, fall back to
    `seedPreviousDrops()`.
- `getActiveDrop({ fresh })` — kept for the checkout route. Returns the
  effective-current drop (effective ∈ {announced, open, soldout}) or `null`
  from a `fresh` (uncached, no-CDN) read. No seed fallback when `fresh` and
  Sanity configured (unchanged intent: authoritative point-of-sale read).
  Note this returns `soldout`/`announced` drops too (they are "current"); the
  checkout route still independently re-derives effective status and 409s
  unless it is exactly `open` (see Consumers #2). The two gates are
  intentional defense-in-depth, not a contradiction.

The Stripe sold-out webhook (`src/sanity/lib/mutations.ts`
`applyOrderToActiveDrop`) is **left as-is**: its internal `status == "open"`
GROQ only ever needs to act on a genuinely-open drop, and checkout (now
effective-status gated) blocks effectively-closed drops before payment. The
close is "soft": a checkout that completes milliseconds after `ordersCloseAt`
can still decrement inventory. Acceptable at this scale; documented in a code
comment.

## Consumers updated to use effective status

1. `src/lib/availability.ts` — `buildAvailability(drop, selections, now =
   new Date())` gains a `now` param; gates on `effectiveDropStatus(drop, now)`
   instead of `drop.status`. `not-open` reason keyed off effective
   `announced`. Fixes storefront Add-to-Cart buttons.
2. `src/app/api/checkout/route.ts` — the 409 gate becomes
   `effectiveDropStatus(drop, new Date()) !== "open"`. Authoritative fix for
   "it still lets me order after close."
3. `src/lib/catalog.ts` `getMemberSelectionsForDrop` — the "defaults haven't
   crystallized" branch (`drop.status === "announced" || "draft"`) uses
   effective status, so Bread Club auto-picks crystallize when a drop
   auto-opens.
4. `src/app/page.tsx` — status badge label, countdown branch (close-timer when
   effective `open`, open-timer when effective `announced`), trust strip, and
   closed-hiding all key off effective status.

## UI: Previous drops section

New server component `src/components/previous-drops.tsx` (keeps `page.tsx`,
already ~376 lines, from growing further). Props: `drops: Drop[]`.

- Rendered on the home page between the current-drop section and the "How
  drops work" section.
- One card per previous drop (≤2): title, ended date (formatted from
  `ordersCloseAt ?? pickupOrShipDate`; the date line is omitted if neither is
  set), an "Ended" badge, and the loaf images
  reusing the existing product-card visual treatment. Loaves are unbuyable:
  no Add-to-Cart control, a muted "Ended" tag.
- Loaf images link to `/product/[slug]` (the product page already handles the
  "not in this drop" state).
- The section renders even when there is no current drop (FOMO between drops).
  The existing "No open drop right now" message stays for the current slot.
- If `previous` is empty, the section renders nothing.

## New / changed files

New:
- `src/lib/drop-status.ts` — `effectiveDropStatus`, `isCurrentDrop`,
  `isPreviousDrop`, `dropRecencyKey`. Pure; imports only `./types`.
- `src/components/previous-drops.tsx` — the section + cards (server component).
- `src/lib/__tests__/drop-status.test.ts` — unit tests via Node's built-in
  `node:test` (Node 20, **zero new dependencies**). Add `"test": "node --test"`
  to `package.json` scripts.

Changed:
- `src/sanity/lib/queries.ts` — replace `ACTIVE_DROP_QUERY` with
  `RECENT_DROPS_QUERY`.
- `src/lib/catalog.ts` — add `getRecentDrops`, `getDropsView`; rework
  `getActiveDrop` onto the list query.
- `src/lib/availability.ts` — `now` param + effective-status gate.
- `src/app/api/checkout/route.ts` — effective-status 409 gate.
- `src/app/page.tsx` — use `getDropsView`, effective status throughout, render
  `<PreviousDrops>`.
- `src/lib/seed-products.ts` — add `seedPreviousDrops(): Drop[]` (2 closed
  drops with past dates, reusing `seedProducts`).

## Testing

- `drop-status.test.ts` covers the full precedence table: every stored status
  × (no dates / before open / between / after close), the seed-drop case, and
  the predicates. Pure function → deterministic, fast, no Sanity/Stripe.
- Manual verification: typecheck, lint, `node --test`, then dev server —
  confirm a past-`ordersCloseAt` drop is unbuyable in UI and returns 409 from
  `/api/checkout`; an `announced` drop with past `ordersOpenAt` is buyable;
  the demo Previous-drops section renders 2 cards. Browser-driven visual check
  of the section at desktop + mobile widths is a best-effort manual step
  (no headless browser in this environment — will be called out, not claimed).

## Acceptance criteria

- A drop with `ordersCloseAt` in the past: not buyable in the UI **and**
  `/api/checkout` returns 409; appears in "Previous drops".
- An `announced` drop with `ordersOpenAt` in the past: buyable; the home page
  shows the close-timer; Bread Club defaults crystallize.
- A drop that sells out before `ordersCloseAt`: stays the headline "Sold out"
  drop until close, then moves to Previous.
- "Previous drops" shows at most 2, most-recently-ended first.
- A drop with no `ordersOpenAt`/`ordersCloseAt`: behaves exactly as today
  (fully manual).
- Zero-config/demo: current seed drop unchanged; 2 seed previous drops shown.

## Risks / tradeoffs (accepted)

- Storefront open/close is accurate to the 60s `revalidate` window; the money
  path (`/api/checkout`) uses a `fresh` uncached read, so it is exact.
- Studio's `status` radio can visually disagree with the live state
  (cosmetic; customers always see correct state).
- Soft close at the checkout/webhook boundary (documented in code).
