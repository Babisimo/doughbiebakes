# Pay-in-Person (Reserve & Pay at Pickup) — Design

Date: 2026-05-17
Status: Approved (pending written-spec review)

## Problem

The only way to order is an online Stripe payment (`cart → /api/checkout →
Stripe → webhook`). Some local customers want to reserve a loaf and pay cash
or card **in person at pickup**. There is no unpaid-order path.

## Goals

1. A second checkout path: **Reserve & pay at pickup** — no online payment,
   Stripe bypassed entirely for these orders.
2. **Pickup-only** (you cannot ship an unpaid order; also keeps the California
   Cottage Food intrastate rule trivially satisfied).
3. A reservation is a **request that holds no stock** until the baker
   approves it. Approval decrements the drop and notifies the customer.
4. The baker manages requests **both** via one-tap signed Approve/Decline
   links in an email **and** an `/admin` list (the source of truth).
5. Reuse existing infrastructure: availability rules, the corrected
   stock-decrement, Resend transport, magic-link signing, BAKER_TOKEN admin
   auth, Sanity docs.

## Non-goals

- No deposit / partial online payment (explicitly rejected — full amount at
  pickup).
- No shipping for reservations (pickup-only).
- No hard per-customer rate limit for MVP (baker approval is the gate; a
  per-email/per-drop cap is a noted easy future add).
- No customer-facing reservation cancellation/edit flow for MVP.
- No auto-expiry of stale pending requests for MVP (noted future option).

## Architecture & flow

Two parallel order paths share the **same authoritative availability rules**
and diverge at payment:

- Existing (unchanged): `cart → /api/checkout → Stripe → webhook` decrements
  stock + sends order emails.
- New (unpaid): `cart → "Reserve & pay at pickup" → /reserve form →
  POST /api/reserve → Sanity reservation doc (pending, NO stock change) →
  emails: customer "request received" + baker "new request + signed
  Approve/Decline links"`. Baker decides via the email link or
  `/admin/reservations`. **Approve** → re-check live stock → decrement the
  drop (shared safe patch) → mark `confirmed` → email customer "pay $X at
  pickup on <pickup date>". **Decline** (or stock gone) → mark `declined` →
  email customer a polite note.

Because stock is held only on approval and approval re-checks live
availability, paid Stripe orders always take precedence — a pending
reservation never blocks a paying buyer.

## Data model

New Sanity schema `reservation` (mirrors existing `member` /
`memberSelection` doc style, registered in the schema index so it also
appears in Studio):

| Field | Type | Notes |
|---|---|---|
| `customerName` | string | required |
| `customerEmail` | string | required; lowercased/trimmed |
| `customerPhone` | string | required |
| `drop` | reference → `drop` | which drop this is against |
| `items` | array of object | each: `productSlug` (string), `productName` (string), `quantity` (number), `priceCents` (number) — name/price snapshotted at request time |
| `totalCents` | number | snapshot of amount due at pickup |
| `status` | string | `pending` \| `confirmed` \| `declined` (radio, initialValue `pending`) |
| `createdAt` | datetime | set on create |
| `decidedAt` | datetime | set when approved/declined |

`productSlug` is the key used to decrement the drop's line item. The snapshot
fields keep the email/admin accurate even if the product later changes.

## Server pieces (isolation-focused)

- **`src/sanity/lib/mutations.ts`**
  - Extract `decrementDropQuantities(dropId, items)` — the safe keyed
    `lineItems[_key==…].quantity` patch (never writes `product`; this is the
    corrected pattern from the corruption fix). It also flips the drop to
    `soldout` when every line hits 0, matching the webhook today.
  - Refactor `applyOrderToActiveDrop` to resolve the open drop's `_id` then
    delegate to `decrementDropQuantities` (one audited decrement path for
    both the Stripe webhook and reservation approval).
  - Add `createReservation(input)` and a guarded
    `setReservationStatus(id, fromStatus, toStatus, decidedAt)` that succeeds
    only if the doc is still in `fromStatus` (implementation may fetch the
    current `_rev` and patch with `ifRevisionId`, or use an equivalent
    conditional mutation — the requirement is the transition is atomic so two
    actors can't double-decrement; the exact API is the plan's call).
- **`src/lib/reservations.ts`** (server-only)
  - `validateReservationCart(items)` — reuses `getActiveDrop({fresh:true})`,
    `getMemberSelectionsForDrop(drop,{fresh:true})`,
    `buildAvailability`/`effectiveDropStatus`. Returns either a normalized,
    priced item list + drop, or a typed rejection (`not-open`,
    `not-in-drop`, `soldout`, `qty-exceeded`) — identical rules to
    `/api/checkout`.
  - `decideReservation(id, action)` — the shared approve/decline
    orchestrator (see Decision logic).
- **`src/lib/reservation-token.ts`** — `signReservationToken(id, action)` /
  `verifyReservationToken(id, action, token)`, HMAC over `id|action` using
  `CLUB_LINK_SECRET` (mirrors `src/lib/club-token.ts`).
- **`src/lib/reservation-email.ts`** — four composers via the existing
  `sendEmail` (Resend): (a) customer "request received — not yet confirmed",
  (b) baker "new pickup request" with absolute signed Approve/Decline URLs,
  (c) customer "confirmed — pay $X cash/card at pickup on <pickup date>",
  (d) customer "declined / sold out before we could confirm". All include
  the `site.cottageFood` "Made in a Home Kitchen" line, like
  `order-email.ts`. HTML-escape customer-controlled fields (name).

## Routes & UI

- **`POST /api/reserve`** (`runtime = "nodejs"`): parse
  `{ items:[{slug,quantity}], name, email, phone }`. Reject empty cart /
  missing fields / invalid email (400). Run `validateReservationCart`; on
  rejection return 409 with the same message style as `/api/checkout`. On
  success: `createReservation` (status `pending`, snapshots). Then
  best-effort emails (customer received + baker new-request). Return
  `{ ok: true }`. If the Sanity write client is unconfigured, return a clear
  503-style error (do **not** silently drop the request).
- **`/api/reservations/decide`**:
  - `GET ?id=&action=&token=` — verify the signed token, call
    `decideReservation`, return a minimal HTML result page (same
    GET-mutation pattern as the existing club magic links).
  - `POST` (BAKER_TOKEN cookie) — for the admin buttons; same
    `decideReservation`.
- **`/reserve`** — server page fetches products/drop/availability (parity
  with the cart page) and renders `src/components/reserve-form.tsx` (client:
  reads the existing cart context from `cart-provider`, collects
  name/email/phone, POSTs `/api/reserve`, shows inline errors, on success
  routes to `/reserve/received`).
- **`/reserve/received`** — simple confirmation ("Request received — we'll
  email you when it's confirmed").
- **`src/components/cart-contents.tsx`** — add a secondary
  **"Reserve & pay at pickup"** button beside "Pre-order with Stripe" that
  links to `/reserve` (only shown when the cart is checkout-eligible, same
  `canCheckout` gate).
- **`src/app/admin/reservations/page.tsx`** — BAKER_TOKEN-protected,
  `export const dynamic = "force-dynamic"`, fresh reads. Lists reservations
  (pending first), each showing customer, items, total, drop, createdAt,
  with Approve/Decline that POST to `/api/reservations/decide`.

## Decision logic (`decideReservation(id, action)`)

1. Fetch the reservation fresh. Not found → error result.
2. If `status !== "pending"` → idempotent no-op; report current status
   (covers double-clicked email links, or link + admin both).
3. **Decline:** `setReservationStatus(id, "pending", "declined", now)` →
   best-effort customer "declined" email → done.
4. **Approve:** fetch the reservation's drop fresh + member selections.
   First require the drop is still effectively `open`
   (`effectiveDropStatus`); if it has closed/sold out/changed since the
   request → `setReservationStatus(id,"pending","declined",now)` (reason
   `unavailable`) → customer "this drop has closed" email → done. Then
   recompute remaining per `productSlug` (`lineItem.quantity` − member
   claims). If any reserved qty exceeds remaining →
   `setReservationStatus(id,"pending","declined",now)` (reason `soldout`) →
   customer "sold out before we could confirm" email → done. Otherwise:
   `setReservationStatus(id,"pending","confirmed",now)` (revision-guarded
   claim) → `decrementDropQuantities(dropId, items)` → best-effort customer
   "confirmed, pay $X at pickup on <pickup date>" email → done.

Ordering note: the status is claimed (pending→confirmed, revision-guarded)
*before* the decrement so a concurrent second actor cannot also decrement;
if the decrement then fails, the reservation is `confirmed` but stock was not
reduced — a rare, baker-visible inconsistency acceptable at Cottage-Food
scale (documented in code; re-running is an idempotent no-op since it is no
longer `pending`). Emails are always best-effort and never block or revert
the state change.

## Edge cases

- Stock depleted between request and approval → auto-decline with `soldout`
  reason + apologetic email.
- Reserved drop closed / sold out / no longer the open drop by approval time
  → auto-decline with `unavailable` reason + "this drop has closed" email.
- Decision on a non-`pending` reservation → friendly no-op.
- Email send failure → reservation/decision still recorded; baker still sees
  it in `/admin/reservations`.
- Drop not open / item not in drop / qty too high at request → 409, same as
  checkout.
- Sanity write client unconfigured → `/api/reserve` returns a clear error.
- Reservations never hold stock pre-approval, so they cannot oversell
  against paid Stripe orders.

## Security

- Email decision links are HMAC-signed (`CLUB_LINK_SECRET`) binding
  `reservationId`+`action`; tampering/forgery rejected. GET-mutation is
  acceptable here for the same reason the existing club magic links use it
  (single-purpose, signed, baker-only).
- Admin decision POST is behind the existing BAKER_TOKEN cookie.
- `/api/reserve` is public (like `/api/checkout`) but fully server-validated;
  no rate limit for MVP (approval is the gate) — accepted trade-off.

## Testing

- `node:test` units (pattern: `src/lib/__tests__/drop-status.test.ts`):
  - `reservation-token`: sign→verify round-trip; reject tampered id/action/
    signature.
  - `validateReservationCart`: given a drop + member selections + requested
    items, returns ok (priced, snapshotted) or the correct typed rejection
    for each failure mode.
  - The pure decrement-quantity computation, if extracted purely, gets a
    unit test (no Sanity).
- Integration/manual (no headless browser here — stated explicitly, not
  claimed): reserve from the cart → baker email arrives with working
  Approve/Decline links → approve decrements stock + customer "confirmed"
  email → decline path → admin list reflects status → stock-depleted-before-
  approval path → typecheck/lint green.

## Acceptance criteria

- Cart shows "Reserve & pay at pickup"; it collects name/email/phone and
  creates a `pending` reservation **without** changing stock.
- Customer gets a "request received" email; baker gets an email with working
  signed Approve/Decline links and sees the request in `/admin/reservations`.
- Approve: re-validates live stock, decrements the drop via the safe patch
  (no `product` corruption), marks `confirmed`, emails the customer the
  amount due + pickup date.
- Decline (or stock gone at approval): marks `declined`, emails the customer.
- All decisions are idempotent; a pending reservation never blocks or
  oversells against a paid Stripe order.
- Reservations are pickup-only; no shipping/address is collected.
- Backward compatible: the existing Stripe path is unchanged; the shared
  `decrementDropQuantities` preserves current webhook behavior.

## Risks / trade-offs (accepted)

- No-shows waste a confirmed loaf with no card to charge — mitigated only by
  the baker's approval judgment (per the chosen model).
- Confirm-without-decrement is possible if the decrement write fails after
  the status claim — rare, baker-visible, no double-decrement on retry.
- No reservation rate limit / expiry in MVP — easy future additions.
