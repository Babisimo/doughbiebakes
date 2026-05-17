# Pay-in-Person (Reserve & Pay at Pickup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an unpaid, pickup-only "Reserve & pay at pickup" path: baker-approved reservations that hold no stock until approval, managed via signed email links and an admin list.

**Architecture:** A new Sanity `reservation` doc records requests (`pending`). A pure evaluator reuses the existing availability rules; a server orchestrator approves/declines (shared with the Stripe webhook's stock-decrement, extracted to one safe helper). Decisions come from HMAC-signed email links or a BAKER_TOKEN admin page.

**Tech Stack:** Next.js 16 (App Router, RSC, TS), Sanity (GROQ + write client), Resend (existing `sendEmail`), `node:test` (Node ≥22.6, `--experimental-strip-types`; `tsconfig` already has `allowImportingTsExtensions`), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-17-pay-in-person-design.md`

---

### Task 1: `reservation` Sanity schema

**Files:**
- Create: `src/sanity/schemaTypes/reservation.ts`
- Modify: `src/sanity/schemaTypes/index.ts`

- [ ] **Step 1: Create the schema**

Create `src/sanity/schemaTypes/reservation.ts`:

```ts
import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * An unpaid "reserve & pay at pickup" request. Created by POST /api/reserve
 * in `pending`; the baker approves/declines (which decrements stock + emails
 * the customer). Stripe is bypassed entirely for these.
 */
export const reservationType = defineType({
  name: "reservation",
  title: "Reservation",
  type: "document",
  fields: [
    defineField({
      name: "customerName",
      title: "Customer name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "customerEmail",
      title: "Customer email",
      type: "string",
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: "customerPhone",
      title: "Customer phone",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "drop",
      title: "Drop",
      type: "reference",
      to: [{ type: "drop" }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "items",
      title: "Items",
      type: "array",
      validation: (rule) => rule.required().min(1),
      of: [
        defineArrayMember({
          type: "object",
          name: "reservationItem",
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
    defineField({ name: "totalCents", title: "Total due at pickup (cents)", type: "number", validation: (r) => r.required().integer().min(0) }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Pending", value: "pending" },
          { title: "Confirmed", value: "confirmed" },
          { title: "Declined", value: "declined" },
        ],
        layout: "radio",
      },
      initialValue: "pending",
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "createdAt", title: "Created at", type: "datetime", readOnly: true, validation: (r) => r.required() }),
    defineField({ name: "decidedAt", title: "Decided at", type: "datetime", readOnly: true }),
  ],
  preview: {
    select: { name: "customerName", status: "status", total: "totalCents" },
    prepare: ({ name, status, total }) => ({
      title: `${name ?? "(customer)"} — ${status ?? "pending"}`,
      subtitle: typeof total === "number" ? `$${(total / 100).toFixed(2)}` : undefined,
    }),
  },
});
```

- [ ] **Step 2: Register it**

In `src/sanity/schemaTypes/index.ts`, add the import after the `memberSelection` import and append `reservationType` to the array. Final file:

```ts
import type { SchemaTypeDefinition } from "sanity";

import { categoryType } from "./category";
import { dropType } from "./drop";
import { memberType } from "./member";
import { memberSelectionType } from "./memberSelection";
import { productType } from "./product";
import { reservationType } from "./reservation";

export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  dropType,
  memberType,
  memberSelectionType,
  reservationType,
];
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: exit 0.
Run: `npm run lint` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/reservation.ts src/sanity/schemaTypes/index.ts
git commit -m "feat: add reservation Sanity schema"
```

---

### Task 2: Reservation token (TDD)

**Files:**
- Create: `src/lib/__tests__/reservation-token.test.ts`
- Create: `src/lib/reservation-token.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/reservation-token.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  signReservationToken,
  verifyReservationToken,
} from "../reservation-token.ts";

process.env.CLUB_LINK_SECRET ||= "test-secret-at-least-16-chars-long";

test("sign then verify round-trips", () => {
  const t = signReservationToken("res123", "approve");
  assert.equal(verifyReservationToken("res123", "approve", t), true);
});

test("rejects wrong action", () => {
  const t = signReservationToken("res123", "approve");
  assert.equal(verifyReservationToken("res123", "decline", t), false);
});

test("rejects wrong id", () => {
  const t = signReservationToken("res123", "approve");
  assert.equal(verifyReservationToken("resXXX", "approve", t), false);
});

test("rejects tampered/garbage token", () => {
  assert.equal(verifyReservationToken("res123", "approve", "deadbeef"), false);
  assert.equal(verifyReservationToken("res123", "approve", ""), false);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test` — Expected: FAIL (`Cannot find module '../reservation-token.ts'`).

- [ ] **Step 3: Implement**

Create `src/lib/reservation-token.ts` (note: **no `import "server-only"`** — that package throws when imported by Node's test runner, making the module untestable. The secret stays server-side anyway: `node:crypto` cannot be bundled into a client component and `CLUB_LINK_SECRET` is not `NEXT_PUBLIC_`, so it is never shipped to the browser — same approach as the tested `drop-status.ts`):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type ReservationAction = "approve" | "decline";

function getSecret(): string {
  const secret = process.env.CLUB_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CLUB_LINK_SECRET is not set (or too short) — reservation links cannot be signed.",
    );
  }
  return secret;
}

export function signReservationToken(id: string, action: ReservationAction): string {
  return createHmac("sha256", getSecret()).update(`${id}|${action}`).digest("hex");
}

export function verifyReservationToken(
  id: string,
  action: ReservationAction,
  token: string,
): boolean {
  if (!id || !action || !token) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(signReservationToken(id, action), "hex");
  } catch {
    return false;
  }
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test` — Expected: all tests pass (`# fail 0`).

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/lib/reservation-token.ts src/lib/__tests__/reservation-token.test.ts
git commit -m "feat: add reservation-token sign/verify (tested)"
```

---

### Task 3: Reservation evaluator (TDD)

**Files:**
- Create: `src/lib/__tests__/reservation-eval.test.ts`
- Create: `src/lib/reservation-eval.ts`

Reuses pure helpers: `effectiveDropStatus` (`src/lib/drop-status.ts`) and `buildAvailability`/`availabilityOf` (`src/lib/availability.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/reservation-eval.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateReservation } from "../reservation-eval.ts";
import type { Drop } from "../types.ts";

const NOW = new Date("2026-05-17T12:00:00.000Z");
const FUTURE = "2026-05-24T12:00:00.000Z";

function product(slug: string, priceCents: number) {
  return { id: slug, slug, name: slug.toUpperCase(), priceCents, available: true };
}
function drop(over: Partial<Drop> = {}): Drop {
  return {
    id: "d1",
    slug: "d1",
    title: "Test Drop",
    status: "open",
    ordersCloseAt: FUTURE,
    lineItems: [
      { product: product("classic", 1100), quantity: 3 },
      { product: product("rye", 1300), quantity: 0 },
    ],
    ...over,
  };
}

test("ok: prices and totals an in-stock request", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "classic", quantity: 2 }], NOW);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.totalCents, 2200);
    assert.deepEqual(r.items, [
      { productSlug: "classic", productName: "CLASSIC", quantity: 2, priceCents: 1100 },
    ]);
  }
});

test("empty cart rejected", () => {
  const r = evaluateReservation(drop(), [], [], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "empty");
});

test("drop not open rejected", () => {
  const r = evaluateReservation(drop({ status: "draft" }), [], [{ slug: "classic", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-open");
});

test("not in drop rejected", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "ghost", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-in-drop");
});

test("sold out rejected", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "rye", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "soldout");
});

test("qty over remaining rejected", () => {
  const r = evaluateReservation(drop(), [], [{ slug: "classic", quantity: 9 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "qty-exceeded");
});

test("null drop rejected as not-open", () => {
  const r = evaluateReservation(null, [], [{ slug: "classic", quantity: 1 }], NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-open");
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test` — Expected: FAIL (`Cannot find module '../reservation-eval.ts'`).

- [ ] **Step 3: Implement**

Create `src/lib/reservation-eval.ts`:

Because `evaluateReservation` imports **values** (not just types) from `./availability` and `./drop-status`, the `node:test` runner must resolve that chain at runtime — so this module AND `src/lib/availability.ts` use explicit `.ts` import specifiers. (`src/lib/availability.ts`'s relative imports — `./types`, `./drop-status` — must be changed to `./types.ts`, `./drop-status.ts` as part of this task.) This is **build-verified safe**: `npm run build` succeeds with these specifiers (Next 16 + `allowImportingTsExtensions`). `drop-status.ts`/`types.ts` need no change — they only `import type` (erased by type-stripping).

```ts
import { availabilityOf, buildAvailability, type MemberSelection } from "./availability.ts";
import { effectiveDropStatus } from "./drop-status.ts";
import type { Drop } from "./types.ts";

export type ReqItem = { slug: string; quantity: number };
export type PricedItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};
export type EvalReason =
  | "empty"
  | "not-open"
  | "not-in-drop"
  | "soldout"
  | "qty-exceeded";
export type EvalResult =
  | { ok: true; items: PricedItem[]; totalCents: number }
  | { ok: false; reason: EvalReason; message: string };

/**
 * Pure: given the open drop, member claims, and a requested cart, either
 * price the cart or explain the first rejection. Same rules as /api/checkout.
 */
export function evaluateReservation(
  drop: Drop | null,
  memberSelections: MemberSelection[],
  items: ReqItem[],
  now: Date,
): EvalResult {
  if (!items || items.length === 0) {
    return { ok: false, reason: "empty", message: "Your order is empty." };
  }
  if (!drop || effectiveDropStatus(drop, now) !== "open") {
    return {
      ok: false,
      reason: "not-open",
      message: "Ordering isn't open right now — check the current drop.",
    };
  }
  const availability = buildAvailability(drop, memberSelections, now);
  const bySlug = new Map(drop.lineItems.map((li) => [li.product.slug, li.product]));
  const priced: PricedItem[] = [];
  for (const item of items) {
    const product = bySlug.get(item.slug);
    const a = availabilityOf(availability, item.slug);
    if (!product || a.reason === "not-in-drop") {
      return {
        ok: false,
        reason: "not-in-drop",
        message: `"${item.slug}" isn't part of this week's drop.`,
      };
    }
    if (!a.canOrder) {
      return {
        ok: false,
        reason: "soldout",
        message: `"${product.name}" is sold out.`,
      };
    }
    if (a.remaining != null && item.quantity > a.remaining) {
      return {
        ok: false,
        reason: "qty-exceeded",
        message: `Only ${a.remaining} ${a.remaining === 1 ? "loaf" : "loaves"} of "${product.name}" left.`,
      };
    }
    priced.push({
      productSlug: product.slug,
      productName: product.name,
      quantity: item.quantity,
      priceCents: product.priceCents,
    });
  }
  const totalCents = priced.reduce((s, p) => s + p.priceCents * p.quantity, 0);
  return { ok: true, items: priced, totalCents };
}
```

> `MemberSelection` is a type exported from `src/lib/availability.ts` (already imported as `import type { MemberSelection } from "./availability"` in `src/lib/catalog.ts`). Import it; do not redefine it. `buildAvailability(drop, memberSelections, now)` and `availabilityOf(map, slug)` are exported from the same module; `effectiveDropStatus(drop, now)` from `src/lib/drop-status.ts`.

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test` — Expected: all pass (`# fail 0`).

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/lib/reservation-eval.ts src/lib/__tests__/reservation-eval.test.ts
git commit -m "feat: add pure reservation evaluator (tested)"
```

---

### Task 4: Shared stock-decrement + reservation mutations

**Files:**
- Modify: `src/sanity/lib/mutations.ts`
- Modify: `src/sanity/lib/queries.ts`

- [ ] **Step 1: Add queries**

In `src/sanity/lib/queries.ts`, append (uses the existing `DROP_FIELDS` fragment and `groq`):

```ts
export const DROP_BY_ID_QUERY = groq`*[_type == "drop" && _id == $id][0] { ${DROP_FIELDS} }`;

export const RESERVATION_BY_ID_QUERY = groq`
  *[_type == "reservation" && _id == $id][0]{
    "id": _id, _rev, customerName, customerEmail, customerPhone,
    "dropId": drop._ref, status, totalCents, createdAt, decidedAt,
    items[]{ productSlug, productName, quantity, priceCents }
  }`;

// Intentionally unfiltered (MVP, low Cottage-Food volume): the admin list
// shows all reservations, pending first. Add a $limit/cutoff if it grows.
export const RESERVATIONS_QUERY = groq`
  *[_type == "reservation"] | order(
    select(status == "pending" => 0, 1) asc, createdAt desc
  ){
    "id": _id, customerName, customerEmail, customerPhone,
    "dropTitle": drop->title, status, totalCents, createdAt, decidedAt,
    items[]{ productSlug, productName, quantity, priceCents }
  }`;
```

- [ ] **Step 2: Refactor decrement + add reservation mutations**

In `src/sanity/lib/mutations.ts`, replace the entire current `applyOrderToActiveDrop` function with the following (this extracts `decrementDropQuantities` and keeps the webhook behavior identical — the safe keyed-`quantity` patch, never writing `product`):

```ts
type SoldItem = { slug: string; quantity: number };

/**
 * Decrement quantities on a specific drop by array `_key` (never writes
 * `product` — that caused the "Key slug not allowed in ref" corruption).
 * Flips the drop to "soldout" when every line hits 0. Shared by the Stripe
 * webhook and reservation approval.
 */
export async function decrementDropQuantities(
  dropId: string,
  items: SoldItem[],
): Promise<void> {
  if (!writeClient || items.length === 0) return;

  const drop = await writeClient.fetch<{
    _id: string;
    lineItems?: { _key: string; quantity?: number; product?: { slug?: { current?: string } } }[];
  } | null>(
    `*[_type == "drop" && _id == $id][0]{
      _id, "lineItems": lineItems[]{ _key, quantity, "product": product->{ "slug": slug } }
    }`,
    { id: dropId },
  );
  if (!drop?.lineItems?.length) return;

  const wanted = new Map(items.map((i) => [i.slug, i.quantity] as const));
  let patch = writeClient.patch(drop._id);
  let changed = false;
  let allZero = true;
  for (const li of drop.lineItems) {
    const slug = li.product?.slug?.current;
    const dec = slug ? wanted.get(slug) ?? 0 : 0;
    const next = Math.max(0, (li.quantity ?? 0) - dec);
    if (dec > 0 && li._key) {
      changed = true;
      patch = patch.set({ [`lineItems[_key=="${li._key}"].quantity`]: next });
    }
    if (next > 0) allZero = false;
  }
  if (!changed) return;
  if (allZero) patch = patch.set({ status: "soldout" });
  await patch.commit({ autoGenerateArrayKeys: false });
}

/**
 * Best-effort: decrement the current open drop after a paid Stripe order.
 */
export async function applyOrderToActiveDrop(items: SoldItem[]): Promise<void> {
  if (!writeClient || items.length === 0) return;
  const open = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "drop" && status == "open"] | order(pickupOrShipDate asc)[0]{ _id }`,
  );
  if (!open?._id) return;
  await decrementDropQuantities(open._id, items);
}
```

Then append the reservation write helpers at the end of `src/sanity/lib/mutations.ts`:

```ts
type ReservationItemInput = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};

export async function createReservation(input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId: string;
  items: ReservationItemInput[];
  totalCents: number;
}): Promise<string | null> {
  if (!writeClient) return null;
  const now = new Date().toISOString();
  const doc = await writeClient.create({
    _type: "reservation",
    customerName: input.customerName,
    customerEmail: input.customerEmail.trim().toLowerCase(),
    customerPhone: input.customerPhone,
    drop: { _type: "reference", _ref: input.dropId },
    items: input.items.map((i) => ({ _type: "reservationItem", ...i })),
    totalCents: input.totalCents,
    status: "pending",
    createdAt: now,
  });
  return doc._id;
}

/**
 * Atomically transition a reservation only if it is still `fromStatus`
 * (fetch current `_rev`, patch with `ifRevisionId`). Returns true if THIS
 * call performed the transition; false if it was already decided / lost the
 * race — callers treat false as an idempotent no-op (no double-decrement).
 */
export async function setReservationStatus(
  id: string,
  fromStatus: string,
  toStatus: string,
): Promise<boolean> {
  if (!writeClient) return false;
  const cur = await writeClient.fetch<{ _rev: string; status: string } | null>(
    `*[_type == "reservation" && _id == $id][0]{ _rev, status }`,
    { id },
  );
  if (!cur || cur.status !== fromStatus) return false;
  try {
    await writeClient
      .patch(id)
      .ifRevisionId(cur._rev)
      .set({ status: toStatus, decidedAt: new Date().toISOString() })
      .commit();
    return true;
  } catch (err) {
    // Swallow ONLY a revision conflict (HTTP 409 — another actor decided it
    // first → idempotent no-op). Re-throw real failures (network/auth) so a
    // transient error is never silently treated as "already decided".
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return false;
    }
    throw err;
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (still `# fail 0`).

- [ ] **Step 4: Commit**

```bash
git add src/sanity/lib/mutations.ts src/sanity/lib/queries.ts
git commit -m "feat: shared decrementDropQuantities + reservation mutations"
```

---

### Task 5: Reservation emails

**Files:**
- Create: `src/lib/reservation-email.ts`

Mirrors `src/lib/order-email.ts` (same `sendEmail`, `site`, `formatPrice`, `escapeHtml` style).

- [ ] **Step 1: Implement**

Create `src/lib/reservation-email.ts`:

```ts
import "server-only";

import { sendEmail } from "./email";
import { formatPrice } from "./money";
import { signReservationToken } from "./reservation-token";
import { site } from "./site";
import { siteUrl } from "./url";

export type ReservationLine = { productName: string; quantity: number; priceCents: number };
export type ReservationEmailInput = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lines: ReservationLine[];
  totalCents: number;
  pickupDate?: string;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
function lines(ls: ReservationLine[]): string {
  return ls
    .map((l) => `  ${l.quantity}x ${l.productName} — ${formatPrice(l.priceCents * l.quantity)}`)
    .join("\n");
}
function when(input: ReservationEmailInput): string {
  return input.pickupDate
    ? new Date(input.pickupDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "the drop date";
}

/** (a) Customer: request received, not yet confirmed. */
export async function sendReservationReceived(input: ReservationEmailInput): Promise<void> {
  const body = [
    `Thanks ${input.customerName} — we got your pickup reservation request.`,
    `It is NOT confirmed yet; ${site.name} will email you once it's approved.`,
    "",
    lines(input.lines),
    `  Total due at pickup: ${formatPrice(input.totalCents)}`,
    "",
    `Pickup in ${site.city} on ${when(input)}. ${site.cottageFood.madeIn}.`,
  ].join("\n");
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — reservation request received`,
      html: `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>`,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] received send failed", err);
  }
}

/** (b) Baker: new request with signed Approve/Decline links. */
export async function sendReservationBakerAlert(input: ReservationEmailInput): Promise<void> {
  const base = siteUrl();
  const link = (action: "approve" | "decline") =>
    `${base}/api/reservations/decide?id=${encodeURIComponent(input.id)}&action=${action}&token=${signReservationToken(input.id, action)}`;
  const body = [
    `New pickup reservation — ${formatPrice(input.totalCents)} due at pickup`,
    `${input.customerName} <${input.customerEmail}> ${input.customerPhone}`,
    "",
    lines(input.lines),
  ].join("\n");
  const html =
    `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>` +
    `<p><a href="${link("approve")}">✅ Approve &amp; hold stock</a> &nbsp;|&nbsp; ` +
    `<a href="${link("decline")}">❌ Decline</a></p>`;
  try {
    await sendEmail({
      to: site.email,
      subject: `🍞 New pickup reservation — ${formatPrice(input.totalCents)}`,
      html,
      text: `${body}\n\nApprove: ${link("approve")}\nDecline: ${link("decline")}`,
    });
  } catch (err) {
    console.error("[reservation-email] baker alert send failed", err);
  }
}

/** (c) Customer: confirmed — pay at pickup. */
export async function sendReservationConfirmed(input: ReservationEmailInput): Promise<void> {
  const body = [
    `You're confirmed, ${input.customerName}! 🍞`,
    "",
    lines(input.lines),
    `  Pay at pickup: ${formatPrice(input.totalCents)} (cash or card)`,
    "",
    `Pickup in ${site.city} on ${when(input)}. ${site.cottageFood.madeIn}. ${site.cottageFood.permitNumber}.`,
  ].join("\n");
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — pickup reservation confirmed`,
      html: `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>`,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] confirmed send failed", err);
  }
}

/** (d) Customer: declined / no longer available. */
export async function sendReservationDeclined(
  input: ReservationEmailInput,
  reason: "declined" | "soldout" | "unavailable",
): Promise<void> {
  const why =
    reason === "soldout"
      ? "those loaves sold out before we could confirm"
      : reason === "unavailable"
        ? "that drop has closed"
        : "we couldn't fulfill this reservation this time";
  const body = [
    `Hi ${input.customerName} — sorry, ${why}.`,
    `No charge was made. Catch the next ${site.name} drop!`,
  ].join("\n");
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — reservation update`,
      html: `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>`,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] declined send failed", err);
  }
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/lib/reservation-email.ts
git commit -m "feat: reservation email templates"
```

---

### Task 6: Reservation orchestration (validate + decide)

**Files:**
- Create: `src/lib/reservations.ts`

- [ ] **Step 1: Implement**

Create `src/lib/reservations.ts`:

```ts
import "server-only";

import { getActiveDrop, getMemberSelectionsForDrop } from "./catalog";
import { evaluateReservation, type EvalResult, type ReqItem } from "./reservation-eval";
import {
  sendReservationConfirmed,
  sendReservationDeclined,
} from "./reservation-email";
import { sanityClient } from "@/sanity/client";
import { DROP_BY_ID_QUERY, RESERVATION_BY_ID_QUERY } from "@/sanity/lib/queries";
import {
  decrementDropQuantities,
  setReservationStatus,
} from "@/sanity/lib/mutations";
import type { Drop } from "./types";

const freshClient = sanityClient?.withConfig({ useCdn: false }) ?? null;

/** Validate a requested cart against the live open drop (same rules as checkout). */
export async function validateReservationCart(items: ReqItem[]): Promise<EvalResult> {
  const drop = await getActiveDrop({ fresh: true });
  const selections = await getMemberSelectionsForDrop(drop, { fresh: true });
  return evaluateReservation(drop, selections, items, new Date());
}

type Reservation = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId: string;
  status: string;
  totalCents: number;
  items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
};

export type DecideResult =
  | { ok: true; status: "confirmed" | "declined"; idempotent?: boolean }
  | { ok: false; error: string };

async function emailInputFor(r: Reservation, pickupDate?: string) {
  return {
    id: r.id,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone,
    lines: r.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      priceCents: i.priceCents,
    })),
    totalCents: r.totalCents,
    pickupDate,
  };
}

export async function decideReservation(
  id: string,
  action: "approve" | "decline",
): Promise<DecideResult> {
  if (!freshClient) return { ok: false, error: "Reservations are not configured." };
  const r = await freshClient.fetch<Reservation | null>(RESERVATION_BY_ID_QUERY, { id });
  if (!r) return { ok: false, error: "Reservation not found." };
  if (r.status !== "pending") {
    return { ok: true, status: r.status as "confirmed" | "declined", idempotent: true };
  }

  if (action === "decline") {
    const moved = await setReservationStatus(id, "pending", "declined");
    if (moved) await sendReservationDeclined(await emailInputFor(r), "declined");
    return { ok: true, status: "declined", idempotent: !moved };
  }

  // approve — re-validate live against the reservation's own drop, reusing
  // the same (tested) evaluator the request used.
  const now = new Date();
  const drop = await freshClient.fetch<Drop | null>(DROP_BY_ID_QUERY, { id: r.dropId });
  const selections = drop ? await getMemberSelectionsForDrop(drop, { fresh: true }) : [];
  const recheck = evaluateReservation(
    drop,
    selections,
    r.items.map((i) => ({ slug: i.productSlug, quantity: i.quantity })),
    now,
  );
  if (!recheck.ok) {
    const declineReason = recheck.reason === "not-open" ? "unavailable" : "soldout";
    const moved = await setReservationStatus(id, "pending", "declined");
    if (moved) await sendReservationDeclined(await emailInputFor(r), declineReason);
    return { ok: true, status: "declined", idempotent: !moved };
  }
  const claimed = await setReservationStatus(id, "pending", "confirmed");
  if (!claimed) {
    const fresh = await freshClient.fetch<Reservation | null>(RESERVATION_BY_ID_QUERY, { id });
    return { ok: true, status: (fresh?.status as "confirmed" | "declined") ?? "confirmed", idempotent: true };
  }
  await decrementDropQuantities(r.dropId, r.items.map((i) => ({ slug: i.productSlug, quantity: i.quantity })));
  await sendReservationConfirmed(await emailInputFor(r, drop.pickupOrShipDate));
  return { ok: true, status: "confirmed" };
}
```

> Because `setReservationStatus` now re-throws non-409 failures (network/auth), wrap the body of `decideReservation` in a `try { … } catch (err) { console.error("[reservations] decide failed", err); return { ok: false, error: "Couldn't process the reservation — please try again." }; }` so a transient failure surfaces as a clean negative result (and a route error page/JSON), never a silent "idempotent". Keep the inner logic exactly as written.
>
> Three review-driven refinements to the approve path: (1) when the drop fetch returns `null` (drop deleted after the request), `console.error("[reservations] drop not found for reservation", r.id, r.dropId)` BEFORE calling `evaluateReservation`, so the resulting auto-decline is diagnosable in logs (this silent-failure class bit us earlier). (2) Add a one-line comment on the `claimed` success block naming the accepted tradeoff: status is set `confirmed` before `decrementDropQuantities`; if the decrement throws, the reservation stays `confirmed` with stock not decremented — baker-visible, and a retry is an idempotent no-op (no double-decrement) but won't re-send the confirm email. (3) Narrow the `!claimed` re-fetch status to avoid a lying cast: `(fresh?.status === "confirmed" || fresh?.status === "declined") ? fresh.status : "confirmed"`.

> `getMemberSelectionsForDrop(drop, { fresh: true })` accepts a `Drop` (used that way in `catalog.ts`/`page.tsx`) and returns `MemberSelection[]`. `getActiveDrop({ fresh: true })` is the same fresh, uncached read the Stripe checkout route uses. Both are exported from `src/lib/catalog.ts`.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`).

```bash
git add src/lib/reservations.ts
git commit -m "feat: reservation validate + decide orchestration"
```

---

### Task 7: `POST /api/reserve`

**Files:**
- Create: `src/app/api/reserve/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/reserve/route.ts`:

```ts
import { createReservation } from "@/sanity/lib/mutations";
import {
  sendReservationBakerAlert,
  sendReservationReceived,
} from "@/lib/reservation-email";
import { validateReservationCart } from "@/lib/reservations";
import { getActiveDrop } from "@/lib/catalog";

export const runtime = "nodejs";

type Body = { name?: unknown; email?: unknown; phone?: unknown; items?: unknown };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it) => {
      const slug = (it as { slug?: unknown })?.slug;
      const qty = Math.floor(Number((it as { quantity?: unknown })?.quantity));
      return typeof slug === "string" && Number.isFinite(qty) && qty > 0
        ? { slug, quantity: Math.min(qty, 20) }
        : null;
    })
    .filter((x): x is { slug: string; quantity: number } => x !== null);

  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) {
    return Response.json(
      { error: "Name, a valid email, and phone are required." },
      { status: 400 },
    );
  }
  if (items.length === 0) {
    return Response.json({ error: "Your order is empty." }, { status: 400 });
  }

  const result = await validateReservationCart(items);
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 409 });
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop) {
    return Response.json(
      { error: "Ordering isn't open right now." },
      { status: 409 },
    );
  }

  const id = await createReservation({
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    dropId: drop.id,
    items: result.items,
    totalCents: result.totalCents,
  });
  if (!id) {
    return Response.json(
      { error: "Reservations are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const emailInput = {
    id,
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    lines: result.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      priceCents: i.priceCents,
    })),
    totalCents: result.totalCents,
    pickupDate: drop.pickupOrShipDate,
  };
  console.info(
    `[reserve] new reservation ${id} — ${name} <${email}> — ` +
      `$${(result.totalCents / 100).toFixed(2)} — ` +
      result.items.map((i) => `${i.quantity}× ${i.productSlug}`).join(", "),
  );
  await sendReservationReceived(emailInput);
  await sendReservationBakerAlert(emailInput);

  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/app/api/reserve/route.ts
git commit -m "feat: POST /api/reserve"
```

---

### Task 8: `/api/reservations/decide` (email links + admin)

**Files:**
- Create: `src/app/api/reservations/decide/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/reservations/decide/route.ts`:

```ts
import { getAdminSession } from "@/lib/admin-auth";
import { decideReservation } from "@/lib/reservations";
import { verifyReservationToken } from "@/lib/reservation-token";

export const runtime = "nodejs";

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function isAction(v: string | null): v is "approve" | "decline" {
  return v === "approve" || v === "decline";
}

// Email magic links (signed).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const action = url.searchParams.get("action");
  const token = url.searchParams.get("token") ?? "";
  if (!id || !isAction(action) || !verifyReservationToken(id, action, token)) {
    return page("Invalid link", "This approve/decline link is invalid or has expired.");
  }
  const r = await decideReservation(id, action);
  if (!r.ok) return page("Couldn't process", r.error);
  if (r.idempotent) return page("Already decided", `This reservation was already <b>${r.status}</b>.`);
  return page(
    r.status === "confirmed" ? "Approved ✅" : "Declined",
    r.status === "confirmed"
      ? "Stock is held and the customer was emailed to pay at pickup."
      : "The customer was emailed.",
  );
}

// Admin buttons (BAKER_TOKEN cookie). Body: { id, action }.
export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { id?: unknown; action?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; action?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : null;
  if (!id || !isAction(action)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const r = await decideReservation(id, action);
  if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
  return Response.json({ ok: true, status: r.status, idempotent: r.idempotent ?? false });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/app/api/reservations/decide/route.ts
git commit -m "feat: reservation decide route (email links + admin)"
```

---

### Task 9: Reserve page + form

**Files:**
- Create: `src/components/reserve-form.tsx`
- Create: `src/app/reserve/page.tsx`
- Create: `src/app/reserve/received/page.tsx`

- [ ] **Step 1: Client form**

Create `src/components/reserve-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCart } from "@/components/cart-provider";
import { type Availability } from "@/lib/availability";
import { formatPrice } from "@/lib/money";
import type { Product } from "@/lib/types";

export function ReserveForm({
  products,
  availability,
}: {
  products: Product[];
  availability: Record<string, Availability>;
}) {
  const { lines, ready } = useCart();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

  const catalog = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);
  const rows = lines
    .map((l) => {
      const product = catalog.get(l.slug);
      const a = availability[l.slug];
      if (!product || !a?.canOrder) return null;
      const qty = a.remaining != null ? Math.min(l.quantity, a.remaining) : l.quantity;
      return { product, quantity: qty };
    })
    .filter((r): r is { product: Product; quantity: number } => r !== null);
  const total = rows.reduce((s, r) => s + r.product.priceCents * r.quantity, 0);

  async function submit() {
    setError(null);
    if (rows.length === 0) {
      setError("Nothing in your order is in this week's drop.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          items: rows.map((r) => ({ slug: r.product.slug, quantity: r.quantity })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not submit your reservation.");
        setSubmitting(false);
        return;
      }
      router.push("/reserve/received");
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (!ready) return <p className="text-ink-500">Loading your order…</p>;
  if (rows.length === 0)
    return (
      <div className="nb-card p-8 text-center">
        <p className="display text-2xl">Nothing to reserve</p>
        <p className="mt-2 text-ink-700">Add loaves from this week&apos;s drop first.</p>
      </div>
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="nb-card space-y-4 p-6">
        <h2 className="display text-xl">Your details</h2>
        {(["name", "email", "phone"] as const).map((f) => (
          <label key={f} className="block">
            <span className="text-xs font-semibold uppercase text-ink-500">{f}</span>
            <input
              type={f === "email" ? "email" : f === "phone" ? "tel" : "text"}
              value={form[f]}
              onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
              className="mt-1 w-full rounded-2xl border border-ink/20 bg-paper px-3 py-2"
              required
            />
          </label>
        ))}
        {error ? <p className="rounded-2xl panel-mono px-3 py-2 text-sm">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !form.name || !form.email || !form.phone}
          className="btn-acid w-full text-sm"
        >
          {submitting ? "Submitting…" : "Request reservation (pay at pickup)"}
        </button>
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          We&apos;ll email you once it&apos;s confirmed · pay cash/card at pickup
        </p>
      </div>
      <aside className="nb-card h-fit space-y-3 p-6">
        <h2 className="display text-xl">Reserving</h2>
        {rows.map((r) => (
          <div key={r.product.slug} className="flex justify-between text-sm">
            <span>{r.quantity}× {r.product.name}</span>
            <span>{formatPrice(r.product.priceCents * r.quantity)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-ink/15 pt-2 text-sm font-bold">
          <span>Due at pickup</span>
          <span>{formatPrice(total)}</span>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Server pages**

Create `src/app/reserve/page.tsx`:

```tsx
import type { Metadata } from "next";

import { ReserveForm } from "@/components/reserve-form";
import { buildAvailability } from "@/lib/availability";
import { getDropsView, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reserve & pay at pickup" };

export default async function ReservePage() {
  const [{ current: drop }, products] = await Promise.all([
    getDropsView(),
    getProducts(),
  ]);
  const selections = await getMemberSelectionsForDrop(drop);
  const map = buildAvailability(drop, selections, new Date());
  const availability = Object.fromEntries(map);

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="display text-5xl sm:text-6xl">Reserve &amp; pay at pickup</h1>
      <p className="mt-3 max-w-prose text-ink-700">
        Local pickup only. Reserve your loaves now and pay cash or card when you
        pick up — we&apos;ll email you once your reservation is confirmed.
      </p>
      <div className="mt-8">
        <ReserveForm products={products} availability={availability} />
      </div>
    </section>
  );
}
```

Create `src/app/reserve/received/page.tsx`:

```tsx
import Link from "next/link";

export const metadata = { title: "Reservation requested" };

export default function ReservationReceivedPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <h1 className="display text-5xl">Request received 🍞</h1>
      <p className="mt-4 text-ink-700">
        Thanks! Your pickup reservation isn&apos;t confirmed yet — we&apos;ll
        email you as soon as it&apos;s approved. No charge until pickup.
      </p>
      <Link href="/" className="btn-acid mt-8 inline-flex text-sm">
        Back home
      </Link>
    </section>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/components/reserve-form.tsx src/app/reserve/page.tsx src/app/reserve/received/page.tsx
git commit -m "feat: /reserve page + form + received confirmation"
```

---

### Task 10: Cart entry point

**Files:**
- Modify: `src/components/cart-contents.tsx`

- [ ] **Step 1: Add the secondary action**

In `src/components/cart-contents.tsx`, the summary `<aside>` has the Stripe button followed by a `<p>` caption. Add a "Reserve & pay at pickup" link directly **after** that closing caption `<p>` and before `</aside>`. Locate:

```tsx
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          Pre-order from a home kitchen · we email to confirm pickup/shipping
        </p>
      </aside>
```

Replace with:

```tsx
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          Pre-order from a home kitchen · we email to confirm pickup/shipping
        </p>
        {canCheckout ? (
          <Link
            href="/reserve"
            className="btn-outline w-full justify-center text-sm"
          >
            Or reserve &amp; pay at pickup (local only)
          </Link>
        ) : null}
      </aside>
```

(`Link` is already imported at the top of this file; `canCheckout` is already in scope.)

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0). Run `npm run dev`, open `/cart` with an in-drop loaf, confirm the new button appears and links to `/reserve`.

```bash
git add src/components/cart-contents.tsx
git commit -m "feat: cart link to reserve & pay at pickup"
```

---

### Task 11: Admin reservations page

**Files:**
- Create: `src/components/reservation-actions.tsx`
- Create: `src/app/admin/reservations/page.tsx`

- [ ] **Step 1: Client action buttons**

Create `src/components/reservation-actions.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReservationActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(action: "approve" | "decline") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reservations/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json()) as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => decide("approve")} className="btn-acid text-xs">
        Approve
      </button>
      <button type="button" disabled={busy} onClick={() => decide("decline")} className="btn-outline text-xs">
        Decline
      </button>
      {msg ? <span className="text-xs text-acid-600">{msg}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: Admin page**

Create `src/app/admin/reservations/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { ReservationActions } from "@/components/reservation-actions";
import { getAdminSession } from "@/lib/admin-auth";
import { formatPrice } from "@/lib/money";
import { sanityClient } from "@/sanity/client";
import { RESERVATIONS_QUERY } from "@/sanity/lib/queries";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropTitle?: string;
  status: "pending" | "confirmed" | "declined";
  totalCents: number;
  createdAt: string;
  items: { productName: string; quantity: number }[];
};

export default async function AdminReservationsPage() {
  if (!(await getAdminSession())) redirect("/admin/login");
  const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;
  const rows = fresh
    ? await fresh.fetch<Row[]>(RESERVATIONS_QUERY, {}, { cache: "no-store" })
    : [];

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="display text-4xl">Pickup reservations</h1>
      {rows.length === 0 ? (
        <p className="mt-6 text-ink-700">No reservations yet.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="nb-card flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="display text-lg">
                  {r.customerName}{" "}
                  <span className={`badge ${r.status === "pending" ? "badge-acid" : r.status === "confirmed" ? "badge-sage" : "badge-flame"}`}>
                    {r.status}
                  </span>
                </p>
                <p className="text-sm text-ink-700">
                  {r.customerEmail} · {r.customerPhone} ·{" "}
                  {r.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")} ·{" "}
                  {formatPrice(r.totalCents)} · {r.dropTitle ?? "—"}
                </p>
              </div>
              {r.status === "pending" ? <ReservationActions id={r.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

> The admin login route is `/admin/login` (`src/app/admin/login/page.tsx` exists and the other `/admin/*` pages gate via `getAdminSession()` from `src/lib/admin-auth.ts`). Reuse that exact pattern.

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0).

```bash
git add src/components/reservation-actions.tsx src/app/admin/reservations/page.tsx
git commit -m "feat: admin reservations list + approve/decline"
```

---

### Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`; reservation-token + reservation-eval + drop-status all pass).

- [ ] **Step 2: Confirm shared decrement is wired**

Run: `git grep -n "decrementDropQuantities" -- src` — Expected: defined in `mutations.ts`, called by `applyOrderToActiveDrop` (webhook path) and `reservations.ts` (approval path). No other whole-`lineItems` `.set(` writes exist (`git grep -n "lineItems:" -- src/sanity` should show only the schema + reservation item mapping, not a drop `lineItems` array set).

- [ ] **Step 3: Manual end-to-end (state explicitly; no headless browser here)**

Dev server + Stripe test mode not required for the reserve path. With Sanity configured:
- `/cart` with an in-drop loaf → "Or reserve & pay at pickup" → `/reserve` → fill name/email/phone → submit → `/reserve/received`.
- Confirm: a `reservation` doc appears in Studio as `pending`, drop stock **unchanged**; customer "received" email + baker email with two links arrive (Resend Logs).
- Click the baker **Approve** link → result page "Approved"; the reservation flips `confirmed`, drop stock decremented (verify in Studio / `scripts/reset-active-drop.mjs` dry-run), customer "confirmed — pay $X" email.
- Repeat, click **Decline** → declined + email; click the link again → "Already decided".
- `/admin/reservations` (after `/admin/login`) lists them; Approve/Decline buttons work and the list refreshes.
- Deplete stock via a Stripe order, then Approve a still-pending reservation → auto-declined "sold out" + email.

- [ ] **Step 4: Commit (only if a fixup was needed)**

If no code changed, skip. Otherwise:

```bash
git add -A -- src
git commit -m "chore: verification fixups for pay-in-person"
```

---

## Notes for the implementer

- **Reuse, don't duplicate:** `decrementDropQuantities` is the *only* place a drop's stock is reduced (webhook + reservation approval both call it). Never write the whole `lineItems` array back — that reintroduces the fixed "Key slug not allowed in ref" corruption.
- **Pure vs IO split:** `reservation-eval.ts` is pure and unit-tested; `reservations.ts` is the IO orchestrator (manual/integration only). Keep evaluation logic in the pure module.
- **Stock is held only on approval.** A pending reservation must never decrement; approval re-validates live (drop still open + quantity) so it cannot oversell against a paid Stripe order.
- **Idempotency:** every decision path tolerates being run twice (signed link clicked twice, or link + admin) via `setReservationStatus`'s revision-guarded transition returning false.
- **`.env.local` is not deployed.** This feature needs `CLUB_LINK_SECRET`, `SANITY_API_WRITE_TOKEN`, `RESEND_API_KEY`, `FROM_EMAIL` set in Vercel for the deployed site (same as the existing flows).
- TypeScript test files import with explicit `.ts` extensions (Node native ESM); `tsconfig.json` already has `allowImportingTsExtensions`.
- **A `node:test`-loaded module's runtime-import chain needs `.ts` specifiers.** `node --test --experimental-strip-types` resolves relative *value* imports at runtime. Type-only imports (`import type`) are erased and need no change. So a tested module that imports values from another source module forces `.ts` specifiers through that chain (here: `reservation-eval.ts` + `availability.ts`). This is build-verified safe (`npm run build` passes with Next 16 + `allowImportingTsExtensions`). Server-only / non-tested modules (`reservations.ts`, routes, pages) stay extensionless.
- **`import "server-only"` is incompatible with the `node:test` runner** (it throws on import outside the Next bundler). Any module that a `*.test.ts` imports must NOT have `server-only` — protect secrets instead via `node:crypto` imports + non-`NEXT_PUBLIC_` env (as `reservation-token.ts` and `drop-status.ts` do). Modules that keep `server-only` (`reservation-email.ts`, `reservations.ts`) are correctly *not* unit-tested (manual/integration only).
