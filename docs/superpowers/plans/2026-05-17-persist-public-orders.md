# Persist Public Orders Implementation Plan (sub-project A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every paid one-off Stripe checkout as an idempotent `order` Sanity doc (best-effort) so the future combined bake list can show public orders.

**Architecture:** Pure `buildOrderRecord` (node:tested, like `reservation-eval`) + idempotent `createOrder` (`createIfNotExists` keyed by Stripe session id, like `upsertMember`) + a new `order` schema + minimal webhook wiring (gate on `mode==="payment"`, capture the open drop id from a refactored `applyOrderToActiveDrop`, best-effort persist). No UI; nothing customer-facing changes.

**Tech Stack:** TypeScript, Sanity write client, Stripe webhook (`checkout.session.completed`), `node:test` (Node ≥22.6, `--experimental-strip-types`; tsconfig has `allowImportingTsExtensions`).

**Spec:** `docs/superpowers/specs/2026-05-17-persist-public-orders-design.md`

> **node:test import rule (established):** `order-record.ts` is pure with **zero relative imports** (all types inline), so its `*.test.ts` (which imports `../order-record.ts`) has no runtime import chain — no `.ts`-specifier propagation. The server-only `mutations.ts` is not node-tested → keep its imports EXTENSIONLESS.

---

### Task 1: `buildOrderRecord` pure mapper (TDD)

**Files:**
- Create: `src/lib/__tests__/order-record.test.ts`
- Create: `src/lib/order-record.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/order-record.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOrderRecord } from "../order-record.ts";

const LOOKUP = new Map([
  ["classic", { name: "Classic", priceCents: 1100 }],
  ["rye", { name: "Rye", priceCents: 1300 }],
]);

function input(over: Partial<Parameters<typeof buildOrderRecord>[0]> = {}) {
  return {
    stripeSessionId: "cs_test_1",
    customerEmail: "  Buyer@Example.com ",
    customerName: "Buyer",
    customerPhone: "+15205550100",
    dropId: "drop-1",
    sold: [{ slug: "classic", quantity: 2 }],
    productLookup: LOOKUP,
    subtotalCents: 2200,
    shippingCents: 0,
    totalCents: 2200,
    isPickup: true,
    shipState: null,
    shipAddress: null,
    livemode: false,
    createdAt: "2026-05-17T12:00:00.000Z",
    ...over,
  };
}

test("maps sold→items via lookup; lowercases email; pickup", () => {
  const r = buildOrderRecord(input());
  assert.ok(r);
  if (r) {
    assert.equal(r.customerEmail, "buyer@example.com");
    assert.equal(r.fulfillment, "pickup");
    assert.equal(r.dropId, "drop-1");
    assert.deepEqual(r.items, [
      { productSlug: "classic", productName: "Classic", quantity: 2, priceCents: 1100 },
    ]);
    assert.equal(r.totalCents, 2200);
    assert.equal(r.shipAddress, undefined);
  }
});

test("null when no email", () => {
  assert.equal(buildOrderRecord(input({ customerEmail: "  " })), null);
});

test("null when no resolvable items", () => {
  assert.equal(
    buildOrderRecord(input({ sold: [{ slug: "ghost", quantity: 1 }] })),
    null,
  );
});

test("ship keeps shipAddress + shipState; pickup drops them", () => {
  const ship = buildOrderRecord(
    input({
      isPickup: false,
      shipState: "CA",
      shipAddress: { line1: "1 A St", city: "Corona", state: "CA", postalCode: "92879" },
    }),
  );
  assert.ok(ship);
  if (ship) {
    assert.equal(ship.fulfillment, "ship");
    assert.equal(ship.shipState, "CA");
    assert.equal(ship.shipAddress?.postalCode, "92879");
  }
  const pickup = buildOrderRecord(
    input({ isPickup: true, shipAddress: { line1: "x" }, shipState: "CA" }),
  );
  assert.ok(pickup);
  if (pickup) {
    assert.equal(pickup.shipAddress, undefined);
    assert.equal(pickup.shipState, "CA"); // shipState kept even for pickup (billing state)
  }
});

test("omits optional fields when absent; normalizes qty/amounts; passthrough livemode", () => {
  const r = buildOrderRecord(
    input({
      customerName: null,
      customerPhone: null,
      dropId: null,
      sold: [{ slug: "rye", quantity: 0 }],
      subtotalCents: -5,
      livemode: true,
    }),
  );
  assert.ok(r);
  if (r) {
    assert.equal("customerName" in r, false);
    assert.equal("customerPhone" in r, false);
    assert.equal("dropId" in r, false);
    assert.equal(r.items[0].quantity, 1); // floored to min 1
    assert.equal(r.subtotalCents, 0); // clamped min 0
    assert.equal(r.livemode, true);
  }
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test`
Expected: FAIL — `Cannot find module '../order-record.ts'`.

- [ ] **Step 3: Implement `src/lib/order-record.ts`**

```ts
export type OrderItemRecord = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};

export type OrderShipAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

export type OrderRecord = {
  stripeSessionId: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  dropId?: string;
  items: OrderItemRecord[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  fulfillment: "pickup" | "ship";
  shipState?: string;
  shipAddress?: OrderShipAddress;
  livemode: boolean;
  createdAt: string;
};

export type BuildOrderInput = {
  stripeSessionId: string;
  customerEmail: string | null | undefined;
  customerName?: string | null;
  customerPhone?: string | null;
  dropId?: string | null;
  sold: { slug: string; quantity: number }[];
  productLookup: Map<string, { name: string; priceCents: number }>;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  isPickup: boolean;
  shipState?: string | null;
  shipAddress?: OrderShipAddress | null;
  livemode: boolean;
  createdAt: string;
};

const cents = (n: number) => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));

/**
 * Pure: shape a paid Stripe session (raw values extracted by the webhook)
 * into an `order` doc record. Returns null when there's no customer email
 * or no resolvable items — the caller logs + skips rather than writing a
 * malformed doc.
 */
export function buildOrderRecord(input: BuildOrderInput): OrderRecord | null {
  const email = input.customerEmail?.trim().toLowerCase();
  if (!email) return null;

  const items: OrderItemRecord[] = [];
  for (const s of input.sold) {
    const p = input.productLookup.get(s.slug);
    if (!p) continue;
    items.push({
      productSlug: s.slug,
      productName: p.name,
      quantity: Math.max(1, Math.floor(s.quantity)),
      priceCents: cents(p.priceCents),
    });
  }
  if (items.length === 0) return null;

  const rec: OrderRecord = {
    stripeSessionId: input.stripeSessionId,
    customerEmail: email,
    items,
    subtotalCents: cents(input.subtotalCents),
    shippingCents: cents(input.shippingCents),
    totalCents: cents(input.totalCents),
    fulfillment: input.isPickup ? "pickup" : "ship",
    livemode: input.livemode,
    createdAt: input.createdAt,
  };
  if (input.customerName) rec.customerName = input.customerName;
  if (input.customerPhone) rec.customerPhone = input.customerPhone;
  if (input.dropId) rec.dropId = input.dropId;
  if (input.shipState) rec.shipState = input.shipState;
  if (!input.isPickup && input.shipAddress) rec.shipAddress = input.shipAddress;
  return rec;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test`
Expected: ALL pass (`# fail 0`; 28 prior + 5 new = 33).

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/lib/order-record.ts src/lib/__tests__/order-record.test.ts
git commit -m "feat: add pure buildOrderRecord mapper (tested)"
```

---

### Task 2: `order` Sanity schema

**Files:**
- Create: `src/sanity/schemaTypes/order.ts`
- Modify: `src/sanity/schemaTypes/index.ts`

- [ ] **Step 1: Create the schema**

Create `src/sanity/schemaTypes/order.ts`:

```ts
import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * A paid one-off public order, written best-effort + idempotently by the
 * Stripe webhook (`createIfNotExists`, `_id = order.<stripeSessionId>`).
 * Bread Club subscription checkouts are NOT orders (webhook gates on
 * `mode === "payment"`).
 */
export const orderType = defineType({
  name: "order",
  title: "Order",
  type: "document",
  fields: [
    defineField({ name: "stripeSessionId", title: "Stripe session id", type: "string", readOnly: true, validation: (r) => r.required() }),
    defineField({ name: "customerEmail", title: "Customer email", type: "string", validation: (r) => r.required().email() }),
    defineField({ name: "customerName", title: "Customer name", type: "string" }),
    defineField({ name: "customerPhone", title: "Customer phone", type: "string" }),
    defineField({ name: "drop", title: "Drop", type: "reference", to: [{ type: "drop" }] }),
    defineField({
      name: "items",
      title: "Items",
      type: "array",
      validation: (rule) => rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "orderItem",
          fields: [
            defineField({ name: "productSlug", title: "Product slug", type: "string", validation: (r) => r.required() }),
            defineField({ name: "productName", title: "Product name", type: "string", validation: (r) => r.required() }),
            defineField({ name: "quantity", title: "Quantity", type: "number", validation: (r) => r.required().integer().min(1) }),
            defineField({ name: "priceCents", title: "Unit price (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
          ],
          preview: {
            select: { title: "productName", quantity: "quantity" },
            prepare: ({ title, quantity }) => ({ title: title ?? "(item)", subtitle: `${quantity ?? 0}×` }),
          },
        }),
      ],
    }),
    defineField({ name: "subtotalCents", title: "Subtotal (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({ name: "shippingCents", title: "Shipping (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({ name: "totalCents", title: "Total (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({
      name: "fulfillment",
      title: "Fulfillment",
      type: "string",
      options: { list: [ { title: "Pickup", value: "pickup" }, { title: "Ship", value: "ship" } ], layout: "radio" },
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "shipState", title: "Ship/billing state", type: "string" }),
    defineField({
      name: "shipAddress",
      title: "Ship address",
      type: "object",
      fields: [
        defineField({ name: "line1", title: "Line 1", type: "string" }),
        defineField({ name: "line2", title: "Line 2", type: "string" }),
        defineField({ name: "city", title: "City", type: "string" }),
        defineField({ name: "state", title: "State", type: "string" }),
        defineField({ name: "postalCode", title: "Postal code", type: "string" }),
      ],
    }),
    defineField({ name: "livemode", title: "Live mode", type: "boolean", validation: (r) => r.required() }),
    defineField({ name: "createdAt", title: "Created at", type: "datetime", readOnly: true, validation: (r) => r.required() }),
  ],
  preview: {
    select: { name: "customerName", email: "customerEmail", total: "totalCents", fulfillment: "fulfillment" },
    prepare: ({ name, email, total, fulfillment }) => ({
      title: (name as string) ?? (email as string) ?? "(order)",
      subtitle: `${typeof total === "number" ? `$${(total / 100).toFixed(2)}` : ""} · ${fulfillment ?? ""}`,
    }),
  },
});
```

- [ ] **Step 2: Register it**

In `src/sanity/schemaTypes/index.ts`, add the import after the `reservation` import and append `orderType` to the array. Final file:

```ts
import type { SchemaTypeDefinition } from "sanity";

import { categoryType } from "./category";
import { dropType } from "./drop";
import { memberType } from "./member";
import { memberSelectionType } from "./memberSelection";
import { orderType } from "./order";
import { productType } from "./product";
import { reservationType } from "./reservation";

export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  dropType,
  memberType,
  memberSelectionType,
  reservationType,
  orderType,
];
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/sanity/schemaTypes/order.ts src/sanity/schemaTypes/index.ts
git commit -m "feat: add order Sanity schema"
```

---

### Task 3: `createOrder` + `applyOrderToActiveDrop` returns drop id

**Files:**
- Modify: `src/sanity/lib/mutations.ts`

- [ ] **Step 1: Confirm the only `applyOrderToActiveDrop` caller**

Run: `git grep -n "applyOrderToActiveDrop" -- src`
Expected: defined in `src/sanity/lib/mutations.ts`; called ONLY in `src/app/api/webhooks/stripe/route.ts`. (Reservation approval uses `decrementDropQuantities` directly.) If any other caller exists, STOP and reconcile before changing the return type.

- [ ] **Step 2: Make `applyOrderToActiveDrop` return the open drop id**

In `src/sanity/lib/mutations.ts`, the current function is exactly:

```ts
export async function applyOrderToActiveDrop(items: SoldItem[]): Promise<void> {
  if (!writeClient || items.length === 0) return;
  const open = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "drop" && status == "open"] | order(pickupOrShipDate asc)[0]{ _id }`,
  );
  if (!open?._id) return;
  await decrementDropQuantities(open._id, items);
}
```

Replace it with:

```ts
export async function applyOrderToActiveDrop(
  items: SoldItem[],
): Promise<string | null> {
  if (!writeClient || items.length === 0) return null;
  const open = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "drop" && status == "open"] | order(pickupOrShipDate asc)[0]{ _id }`,
  );
  if (!open?._id) return null;
  await decrementDropQuantities(open._id, items);
  return open._id;
}
```

- [ ] **Step 3: Add `createOrder`**

Add this import near the top of `src/sanity/lib/mutations.ts` (with the other imports; `mutations.ts` is `server-only` and not node-tested, so EXTENSIONLESS):

```ts
import type { OrderRecord } from "@/lib/order-record";
```

Append at the END of `src/sanity/lib/mutations.ts`:

```ts
/**
 * Idempotently persist a paid public order. The deterministic
 * `_id = order.<stripeSessionId>` + `createIfNotExists` make duplicate
 * `checkout.session.completed` webhook deliveries a no-op. Returns false
 * when Sanity isn't configured (best-effort).
 */
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

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`, 33 pass).

```bash
git add src/sanity/lib/mutations.ts
git commit -m "feat: createOrder mutation + applyOrderToActiveDrop returns drop id"
```

---

### Task 4: Wire order persistence into the webhook

**Files:**
- Modify: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Imports + a `mapAddr` helper**

In `src/app/api/webhooks/stripe/route.ts`, the existing import block contains (among others):

```ts
import { applyOrderToActiveDrop, upsertMember } from "@/sanity/lib/mutations";
```

Change that line to add `createOrder`, and add the `order-record` import + a Stripe import for the address type. The relevant imports become:

```ts
import { applyOrderToActiveDrop, createOrder, upsertMember } from "@/sanity/lib/mutations";
import { buildOrderRecord, type OrderShipAddress } from "@/lib/order-record";
```

Then add this module-scope helper (place it directly above `async function handleCompletedCheckout`):

```ts
function mapAddr(
  a:
    | { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null }
    | null
    | undefined,
): OrderShipAddress | null {
  if (!a) return null;
  const out: OrderShipAddress = {};
  if (a.line1) out.line1 = a.line1;
  if (a.line2) out.line2 = a.line2;
  if (a.city) out.city = a.city;
  if (a.state) out.state = a.state;
  if (a.postal_code) out.postalCode = a.postal_code;
  return Object.keys(out).length > 0 ? out : null;
}
```

- [ ] **Step 2: Capture the open drop id**

In `handleCompletedCheckout`, the current inventory block is exactly:

```ts
  try {
    await applyOrderToActiveDrop(sold);
  } catch (err) {
    console.error("[webhook] failed to update drop inventory:", err);
  }
```

Replace with (capture the returned drop id; behavior otherwise identical):

```ts
  let dropId: string | null = null;
  try {
    dropId = await applyOrderToActiveDrop(sold);
  } catch (err) {
    console.error("[webhook] failed to update drop inventory:", err);
  }
```

- [ ] **Step 3: Build `productLookup` in the existing email line-items block**

The current email line-items block is exactly:

```ts
  let emailLines: OrderEmailLine[] = [];
  try {
    const li = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ["data.price.product"],
    });
    emailLines = li.data.map((item) => {
      const product = item.price?.product;
      const name =
        item.description ??
        (product && typeof product !== "string" && !("deleted" in product)
          ? product.name
          : "Loaf");
      return {
        name,
        quantity: item.quantity ?? 1,
        amountCents: item.amount_total ?? 0,
      };
    });
  } catch (err) {
    console.error("[webhook] failed to list line items for email:", err);
  }
```

Replace with (same single `listLineItems` call; additionally populate a `productLookup` `slug → { name, priceCents }` from the same `li.data` — no extra Stripe call):

```ts
  let emailLines: OrderEmailLine[] = [];
  const productLookup = new Map<string, { name: string; priceCents: number }>();
  try {
    const li = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ["data.price.product"],
    });
    emailLines = li.data.map((item) => {
      const product = item.price?.product;
      const resolved =
        product && typeof product !== "string" && !("deleted" in product)
          ? product
          : null;
      const name = item.description ?? resolved?.name ?? "Loaf";
      const slug = resolved?.metadata?.slug;
      if (slug) {
        productLookup.set(slug, {
          name: resolved?.name ?? item.description ?? "Loaf",
          priceCents: item.price?.unit_amount ?? 0,
        });
      }
      return {
        name,
        quantity: item.quantity ?? 1,
        amountCents: item.amount_total ?? 0,
      };
    });
  } catch (err) {
    console.error("[webhook] failed to list line items for email:", err);
  }
```

- [ ] **Step 4: Persist the order (best-effort, gated on `mode === "payment"`)**

The function currently ends with the `await sendOrderEmails({ ... });` call followed by `}`. Insert the order-persistence block **immediately before** `await sendOrderEmails({`. Locate:

```ts
  // Best-effort: never blocks the 200 (sendOrderEmails swallows its own errors).
  await sendOrderEmails({
```

Replace that with:

```ts
  // Best-effort: persist a public-order record (Bread Club subscription
  // checkouts are `mode: "subscription"` — never recorded as orders).
  if (session.mode === "payment") {
    const rec = buildOrderRecord({
      stripeSessionId: session.id,
      customerEmail: customerEmail,
      customerName: session.customer_details?.name,
      customerPhone: session.customer_details?.phone,
      dropId,
      sold,
      productLookup,
      subtotalCents: session.amount_subtotal ?? 0,
      shippingCents: session.shipping_cost?.amount_total ?? 0,
      totalCents: session.amount_total ?? 0,
      isPickup,
      shipState: state,
      shipAddress: isPickup
        ? null
        : mapAddr(
            session.collected_information?.shipping_details?.address ??
              session.customer_details?.address,
          ),
      livemode: session.livemode,
      createdAt: new Date().toISOString(),
    });
    if (rec) {
      try {
        await createOrder(rec);
      } catch (err) {
        console.error("[webhook] ORDER NOT PERSISTED", session.id, err);
      }
    } else {
      console.warn(
        "[webhook] order not recorded — no resolvable items/email",
        session.id,
      );
    }
  }

  // Best-effort: never blocks the 200 (sendOrderEmails swallows its own errors).
  await sendOrderEmails({
```

(`customerEmail`, `sold`, `isPickup`, `state`, `dropId`, `productLookup` are all already in scope at this point in `handleCompletedCheckout`. The `if (!customerEmail) { …; return; }` guard above means `customerEmail` is a non-empty string here, but `buildOrderRecord` re-validates it anyway.)

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`, 33 pass), `npm run build` (succeeds).

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: persist public orders from the Stripe webhook (best-effort)"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

Run: `npm run typecheck` (exit 0); `npm run lint` (exit 0); `npm test` (`# fail 0`, 33: 12 drop-status + 4 reservation-token + 7 reservation-eval + 5 email-layout + 5 order-record); `npm run build` (succeeds, all routes).

- [ ] **Step 2: Idempotency + gate wiring (read-only)**

- `git grep -n "createIfNotExists" -- src/sanity/lib/mutations.ts` → confirm `createOrder` uses `createIfNotExists` with `_id: \`order.${rec.stripeSessionId}\``.
- `git grep -n "session.mode" -- src/app/api/webhooks/stripe/route.ts` → confirm the order block is gated by `session.mode === "payment"`.
- `git grep -n "applyOrderToActiveDrop" -- src` → still only mutations.ts (def) + the webhook (one call, now assigned to `dropId`).
- Confirm only ONE `stripe.checkout.sessions.listLineItems(` call exists in the email/order path (the `sold.length === 0` fallback call earlier in the function is the only other one — that's pre-existing, unchanged, acceptable).

- [ ] **Step 3: Invariants unchanged (diff inspection)**

`git show` the Task 3 + Task 4 commits and confirm: no `subject:`/`to:`/`text:` of `sendOrderEmails` changed; the inventory decrement still happens (just its return captured); the `if (!customerEmail) return` guard, the Cottage-Food state warning, and the `sold` parsing are unchanged; `decrementDropQuantities`/`createReservation`/`setReservationStatus`/member mutations untouched. Report any deviation.

- [ ] **Step 4: Manual / integration (state explicitly; NOT verified here)**

No Stripe/headless env here. Report as **manual, post-merge**: a real test-mode one-off checkout → Stripe Dashboard shows webhook 200 → an `order` doc appears in Sanity Studio with correct items/amounts/fulfillment/`drop` ref/`livemode:false`; re-deliver the same `checkout.session.completed` event → NO duplicate doc (idempotent); a Bread Club **subscription** checkout → NO `order` doc; a one-off checkout while no drop is `open` → an `order` doc with NO `drop` ref. (No bake-list/UI yet — that's sub-project B.)

- [ ] **Step 5: Commit only if a fixup was required**

If nothing changed, skip. Otherwise `git add -A -- src && git commit -m "chore: verification fixups for persist-public-orders"`. Never touch the unrelated untracked `public/sourdough/`.

---

## Notes for the implementer

- **Only persistence is added.** Email subjects/recipients/bodies, the
  inventory decrement, the Cottage-Food warning, and `sold` parsing are
  unchanged. The webhook still returns 200 regardless (all order code is
  best-effort).
- **Idempotent by construction:** `_id = order.<stripeSessionId>` +
  `createIfNotExists`. Never switch to `create()` (would duplicate on
  Stripe's at-least-once redelivery).
- **`mode === "payment"` gate is load-bearing** — without it, Bread Club
  subscription checkouts (`mode: "subscription"`) would be recorded as
  orders. Do not remove it.
- **No new `listLineItems` call** — `productLookup` is built from the one
  the email path already makes. The pre-existing `sold.length === 0`
  fallback `listLineItems` is separate and untouched.
- `order-record.ts` is pure with **zero imports** → its test imports
  `../order-record.ts` with `.ts`; nothing else needs `.ts` changes. The
  server-only `mutations.ts`/route keep EXTENSIONLESS imports.
- Best-effort posture is deliberate (per spec): a Sanity write failure logs
  `[webhook] ORDER NOT PERSISTED <sessionId>` and still 200s; Stripe
  Dashboard is the backstop. No forced retries; decrement stays
  non-idempotent (unchanged).
