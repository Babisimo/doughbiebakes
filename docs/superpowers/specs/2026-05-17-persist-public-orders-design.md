# Persist Public Orders — Design (sub-project A)

Date: 2026-05-17
Status: Approved (pending written-spec review)

## Problem

Public one-off Stripe orders are **never persisted**. The Stripe webhook
`handleCompletedCheckout` only decrements drop inventory, sends emails, and
logs `[webhook] ✅ Paid order …`. There is no `order` document type in
Sanity (`member`, `memberSelection`, `reservation` exist; no `order`). The
admin bake list (`/admin/club/[dropId]`) therefore shows **member picks
only** and its own UI says "Public orders are separate — check Stripe
Dashboard". The combined bake list the owner wants (members + public +
confirmed reservations) cannot list public orders that were never recorded.

This spec covers **sub-project A only: start recording paid public orders**.
The combined bake-list view is sub-project B (separate spec → plan → build,
done after A).

## Goal

On every paid one-off checkout, persist an `order` document in Sanity —
idempotently, best-effort — so sub-project B can aggregate it into the bake
list. No customer-facing change; no change to when/whether emails send or
inventory decrements.

## Non-goals

- No bake-list UI / query changes (sub-project B).
- No change to email/inventory behavior, recipients, subjects, or signed
  links.
- No "guaranteed/retry-until-recorded" durability — explicitly chosen
  **best-effort + loud log** (Stripe Dashboard is the backstop at
  Cottage-Food volume). The inventory decrement stays non-idempotent; we do
  NOT force Stripe retries.
- Bread Club *subscription* checkouts are not "orders" and must not be
  recorded.

## Architecture (Approach A: pure mapper + idempotent mutation + webhook wiring)

Mirrors the established `reservation-eval` (pure, node-tested) ↔
`mutations.ts` (IO) split. The Stripe SDK stays in the webhook; the
shaping/validation is a pure, unit-tested function; persistence is an
idempotent mutation.

### 1. `order` Sanity schema

New `src/sanity/schemaTypes/order.ts` exporting `orderType`, registered in
`src/sanity/schemaTypes/index.ts` after `reservationType` (mirrors
`reservation.ts`: `defineType`/`defineField`/`defineArrayMember`).

| Field | Type | Notes |
|---|---|---|
| `stripeSessionId` | string | readOnly, required; basis for the deterministic `_id` |
| `customerEmail` | string | required |
| `customerName` | string | optional |
| `customerPhone` | string | optional |
| `drop` | reference → `drop` | optional (the open drop at order time; best-effort) |
| `items` | array of `orderItem` | required, min 1; each: `productSlug` (string, req), `productName` (string, req), `quantity` (number, req int min 1), `priceCents` (number, req int min 0 — unit price) |
| `subtotalCents` | number | required int min 0 |
| `shippingCents` | number | required int min 0 |
| `totalCents` | number | required int min 0 |
| `fulfillment` | string | radio `pickup`\|`ship`, required |
| `shipState` | string | optional |
| `shipAddress` | object | optional: `line1`/`line2`/`city`/`state`/`postalCode` (snapshot for ship orders so the bake list needs no per-render Stripe lookups) |
| `livemode` | boolean | required (so test orders are filterable) |
| `createdAt` | datetime | readOnly, required |

Preview: title `customerName ?? customerEmail`, subtitle
`$<total> · <fulfillment>`.

### 2. Pure mapper `src/lib/order-record.ts`

No `import "server-only"` (must be `node:test`-importable, like
`drop-status`/`reservation-eval`; contains no secrets, no Stripe SDK). Only
type-only relative imports if any (so the node:test runtime-import chain
stays clean — no `.ts`-specifier propagation needed).

Exports:
- `type OrderItemRecord = { productSlug: string; productName: string; quantity: number; priceCents: number }`
- `type OrderShipAddress = { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string }`
- `type OrderRecord = { stripeSessionId: string; customerEmail: string; customerName?: string; customerPhone?: string; dropId?: string; items: OrderItemRecord[]; subtotalCents: number; shippingCents: number; totalCents: number; fulfillment: "pickup" | "ship"; shipState?: string; shipAddress?: OrderShipAddress; livemode: boolean; createdAt: string }`
- `buildOrderRecord(input: { stripeSessionId: string; customerEmail: string | null | undefined; customerName?: string | null; customerPhone?: string | null; dropId?: string | null; sold: { slug: string; quantity: number }[]; productLookup: Map<string, { name: string; priceCents: number }>; subtotalCents: number; shippingCents: number; totalCents: number; isPickup: boolean; shipState?: string | null; shipAddress?: OrderShipAddress | null; livemode: boolean; createdAt: string }): OrderRecord | null`

Logic: trim/lowercase email; for each `sold` entry resolve `productLookup`
→ `{ productName, priceCents }` (skip entries with no lookup hit);
**return `null`** if `customerEmail` is empty/invalid OR the resolved
`items` array is empty (caller logs + skips — never writes a malformed
doc). `fulfillment = isPickup ? "pickup" : "ship"`. Pass amounts/livemode/
createdAt through. Drop empty optional fields.

### 3. Idempotent `createOrder` in `src/sanity/lib/mutations.ts`

```
export async function createOrder(rec: OrderRecord): Promise<boolean> {
  if (!writeClient) return false;
  await writeClient.createIfNotExists({
    _id: `order.${rec.stripeSessionId}`,
    _type: "order",
    stripeSessionId: rec.stripeSessionId,
    customerEmail: rec.customerEmail,
    ...(rec.customerName ? { customerName: rec.customerName } : {}),
    ...(rec.customerPhone ? { customerPhone: rec.customerPhone } : {}),
    ...(rec.dropId ? { drop: { _type: "reference", _ref: rec.dropId } } : {}),
    items: rec.items.map((i) => ({ _type: "orderItem", ...i })),
    subtotalCents: rec.subtotalCents,
    shippingCents: rec.shippingCents,
    totalCents: rec.totalCents,
    fulfillment: rec.fulfillment,
    ...(rec.shipState ? { shipState: rec.shipState } : {}),
    ...(rec.shipAddress ? { shipAddress: rec.shipAddress } : {}),
    livemode: rec.livemode,
    createdAt: rec.createdAt,
  });
  return true;
}
```

`createIfNotExists` keyed by `order.${stripeSessionId}` makes duplicate
`checkout.session.completed` deliveries a no-op (exact pattern of
`upsertMember`, whose `_id` is the Stripe customer id). `OrderRecord` type
imported from `@/lib/order-record` (type-only; `mutations.ts` is
`server-only`, not node-tested → extensionless import). Returns `false`
when Sanity is unconfigured (best-effort).

### 4. `applyOrderToActiveDrop` refactor + webhook wiring

- `applyOrderToActiveDrop(items)` currently finds the open drop's `_id`
  internally then delegates to `decrementDropQuantities`. Change its return
  type from `Promise<void>` to **`Promise<string | null>`** returning that
  open drop `_id` (or `null`). Grep-confirm the only caller is
  `src/app/api/webhooks/stripe/route.ts` (reservation approval uses
  `decrementDropQuantities` directly, not `applyOrderToActiveDrop`); that
  caller currently ignores the return → still compiles; behavior otherwise
  unchanged.
- In `src/app/api/webhooks/stripe/route.ts` `handleCompletedCheckout`:
  1. **Gate:** if `session.mode !== "payment"`, skip order persistence
     entirely (Bread Club subscription checkouts also fire
     `checkout.session.completed` — they must NOT become orders). Inventory/
     email behavior for non-payment sessions is unchanged.
  2. `const dropId = await applyOrderToActiveDrop(sold);` (now returns id).
  3. Consolidate to a single `stripe.checkout.sessions.listLineItems(
     session.id, { expand: ["data.price.product"] })` call; from it derive
     BOTH the email lines (as today) AND a `productLookup`
     `Map<slug, { name, priceCents }>` where `slug` =
     `price.product.metadata.slug`, `name` = `price.product.name ??
     item.description`, `priceCents` = `price.unit_amount ?? 0` (UNIT
     price, not the line total). Reuse the **existing** `sold`
     (`{slug,quantity}[]`, already parsed from `metadata.cart` with the
     line-items fallback) — do NOT introduce a second `sold`.
  4. `const rec = buildOrderRecord({ stripeSessionId: session.id,
     customerEmail: session.customer_details?.email, customerName:
     session.customer_details?.name, customerPhone:
     session.customer_details?.phone, dropId, sold, productLookup,
     subtotalCents: session.amount_subtotal ?? 0, shippingCents:
     session.shipping_cost?.amount_total ?? 0, totalCents:
     session.amount_total ?? 0, isPickup, shipState: state, shipAddress:
     isPickup ? null : mapAddr(session.collected_information
     ?.shipping_details?.address ?? session.customer_details?.address),
     livemode: session.livemode, createdAt: new Date().toISOString() })`,
     where `mapAddr` maps Stripe's snake-case to the doc shape
     (`line1`, `line2`, `city`, `state`, `postal_code → postalCode`) and
     returns `null` if there is no address. `shipAddress` is recorded ONLY
     for `ship` orders.
  5. If `rec`: `try { await createOrder(rec); } catch (err) {
     console.error("[webhook] ORDER NOT PERSISTED", session.id, err); }`.
     If `!rec`: `console.warn("[webhook] order not recorded — no
     resolvable items/email", session.id)`.
  6. Existing `sendOrderEmails(...)` unchanged. Return 200 as today.

  None of step 1–5 blocks the 200; all best-effort.

## Edge cases (all handled)

- Duplicate webhook delivery → `createIfNotExists` no-op (idempotent).
- No open drop at order time → `dropId` null → order stored WITHOUT a `drop`
  ref (recorded, not lost).
- Sanity write fails → caught, distinct `[webhook] ORDER NOT PERSISTED`
  log, 200 still returned. Recoverable from Stripe Dashboard.
- Sanity unconfigured (demo) → `createOrder` returns false (no-op).
- Synthetic/`stripe trigger` event with no email or no resolvable items →
  `buildOrderRecord` returns null → warn log, no malformed doc.
- Bread Club subscription checkout (`mode !== "payment"`) → skipped.
- `livemode` recorded so sub-project B can filter test vs live orders.

## Files

- **New** `src/lib/order-record.ts` (pure: types + `buildOrderRecord`).
- **New** `src/lib/__tests__/order-record.test.ts` (`node:test`, imports
  `../order-record.ts`).
- **New** `src/sanity/schemaTypes/order.ts` (`orderType`).
- **Changed** `src/sanity/schemaTypes/index.ts` (register `orderType` after
  `reservationType`).
- **Changed** `src/sanity/lib/mutations.ts` (`createOrder`;
  `applyOrderToActiveDrop` returns `string | null`).
- **Changed** `src/app/api/webhooks/stripe/route.ts` (`mode==="payment"`
  gate, capture dropId, consolidate line-items fetch, build + createOrder
  best-effort).

## Testing

- `node:test` `order-record.test.ts`: `buildOrderRecord` maps `sold` →
  `items` via `productLookup`; returns `null` on empty email / no resolvable
  items; pickup vs ship → `fulfillment`; amounts/livemode/createdAt
  pass-through; optional fields omitted when absent. Pure → deterministic.
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` green.
- **Manual / integration (stated, not verified here — no headless browser /
  Stripe in this env):** a real test-mode checkout → Stripe Dashboard shows
  the webhook 200 → an `order` doc appears in Studio with correct fields;
  re-delivering the same event creates **no** duplicate; a Bread Club
  subscription checkout creates **no** order; a checkout with no open drop
  still records an order (no `drop` ref).

## Acceptance criteria

- A new `order` Sanity type exists and is registered.
- Every paid `mode === "payment"` checkout writes exactly one `order` doc,
  idempotent on Stripe session id; subscription checkouts write none.
- `buildOrderRecord` is pure and unit-tested; `createOrder` uses
  `createIfNotExists` with `_id = order.<sessionId>`.
- Order persistence is best-effort: a failure logs
  `[webhook] ORDER NOT PERSISTED <sessionId>` and still returns 200; emails
  and inventory decrement behavior are byte-for-byte unchanged.
- `applyOrderToActiveDrop` returns the open drop id; no other behavior
  changes; the existing webhook still compiles/works.
- typecheck / lint / node:test / build all pass.

## Risks / tradeoffs (accepted)

- Best-effort persistence: a transient Sanity outage during a webhook can
  drop one order from Sanity (still in Stripe Dashboard, and inventory still
  decremented). Accepted at Cottage-Food volume per the durability decision.
- The webhook handler remains non-idempotent for the inventory decrement
  (unchanged); we deliberately do not force Stripe retries.
- `priceCents` is the unit price snapshot at order time; refunds/partial
  refunds are not reflected (out of scope; Stripe Dashboard is source of
  truth for money).
