# Amend Reservation Pricing & Collected Amount — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the baker amend a confirmed reservation's per-loaf prices and record a separate "actually collected" amount, from `/admin/reservations`.

**Architecture:** Reuse the existing `reservation` document and per-item `priceCents` favors model. Add one optional schema field `collectedCents`. A pure body-parser + a thin Sanity patch mutation + an authed dynamic API route do the write; a client component on the reservations page does the edit UI. The calculator reads `collectedCents ?? totalCents` for "Actually collected"; favors math is unchanged.

**Tech Stack:** Next.js 16 (App Router, async route params), React 19 client components, Sanity (`@sanity/client` write client), `node:test` + `node:assert/strict` for pure-logic tests (run via `node --test --experimental-strip-types`).

## Global Constraints

- **Read the bundled Next docs before App-Router code.** Per `AGENTS.md`, this Next.js (16.2.6) has breaking changes; relevant guide already checked: dynamic route handlers take `{ params }: { params: Promise<{ id: string }> }` and you must `await params` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`).
- **Tests live beside source** as `*.test.ts`, use `node:test` + `node:assert/strict`, and import siblings with explicit `.ts` extensions (e.g. `from "./favors.ts"`).
- **Money is integer cents** everywhere. Coerce with `Math.round(Number(v))`; reject non-finite.
- **Never edit quantities, stock, status, or buyer fields** in this feature. Amend touches prices + `collectedCents` only.
- **Degrade-to-configured:** mutations return `false`/`null` and routes return `503` when `writeClient` is unconfigured (mirror `createInPersonSale` / the in-person route).
- **Commit message trailer:** end each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure money helper — `reservationCollectedCents` + own-bread total test

**Files:**
- Modify: `src/lib/favors.ts` (append a helper)
- Test: `src/lib/favors.test.ts` (append cases)

**Interfaces:**
- Consumes: nothing.
- Produces: `reservationCollectedCents(r: { collectedCents?: number | null; totalCents: number }): number` — returns `r.collectedCents` when it is a finite number, else `r.totalCents`. Used by Task 6 (calculator).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/favors.test.ts`:

```ts
import {
  actualFavorsCents,
  computeSaleTotals,
  reservationCollectedCents,
  type SaleLineInput,
  type SoldSource,
} from "./favors.ts";

test("computeSaleTotals: a loaf reserved for yourself at $0 is a full-list favor", () => {
  const r = computeSaleTotals([sale({ quantity: 1, priceCents: 0, listPriceCents: 1200 })]);
  assert.equal(r.totalCents, 0);
  assert.equal(r.favorsCents, 1200);
});

test("reservationCollectedCents: falls back to totalCents when no override", () => {
  assert.equal(reservationCollectedCents({ totalCents: 1200 }), 1200);
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: undefined }), 1200);
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: null }), 1200);
});

test("reservationCollectedCents: uses the override when present (incl. 0)", () => {
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: 1000 }), 1000);
  assert.equal(reservationCollectedCents({ totalCents: 1200, collectedCents: 0 }), 0);
});
```

Note: `favors.test.ts` already imports `actualFavorsCents, computeSaleTotals, type SaleLineInput, type SoldSource` at the top. Do NOT duplicate that import line — instead add `reservationCollectedCents` to the existing import and append only the three `test(...)` blocks. (The import block above shows the final shape of the existing import for reference.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/favors.test.ts`
Expected: FAIL — `reservationCollectedCents` is not exported (`SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Implement the helper**

Append to `src/lib/favors.ts` (after `actualFavorsCents`):

```ts
/**
 * What a reservation actually collected: the explicit `collectedCents` override
 * when set, otherwise the reserved `totalCents`. A `$0` override is honored
 * (a loaf reserved for yourself), so only a non-number falls back.
 */
export function reservationCollectedCents(r: {
  collectedCents?: number | null;
  totalCents: number;
}): number {
  return typeof r.collectedCents === "number" && Number.isFinite(r.collectedCents)
    ? r.collectedCents
    : r.totalCents;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/favors.test.ts`
Expected: PASS (all favors tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/favors.ts src/lib/favors.test.ts
git commit -m "feat(favors): add reservationCollectedCents helper + $0 own-bread test"
```

---

### Task 2: Pure amend-body parser — `parseAmendBody`

**Files:**
- Create: `src/lib/reservation-amend.ts`
- Test: `src/lib/reservation-amend.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AmendItem = { productSlug: string; productName: string; quantity: number; priceCents: number; listPriceCents: number }`
  - `type AmendInput = { items?: AmendItem[]; collectedCents?: number | null }`
  - `parseAmendBody(body: unknown): { ok: true; value: AmendInput } | { ok: false; error: string }`
  - Used by Task 5 (API route).

Rules: integers via `Math.round(Number(v))`. `items` (when present) must be a non-empty array; each item needs a non-empty `productSlug`, `quantity ≥ 1`, `priceCents ≥ 0`, `listPriceCents ≥ 0`. `collectedCents` (when present) must be `null` or an integer `≥ 0`. At least one of `items`/`collectedCents` must be present.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reservation-amend.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAmendBody } from "./reservation-amend.ts";

const item = (over = {}) => ({
  productSlug: "classic",
  productName: "Classic",
  quantity: 1,
  priceCents: 1200,
  listPriceCents: 1200,
  ...over,
});

test("rejects a non-object body", () => {
  assert.equal(parseAmendBody(null).ok, false);
  assert.equal(parseAmendBody("x").ok, false);
});

test("rejects when nothing is being updated", () => {
  const r = parseAmendBody({});
  assert.equal(r.ok, false);
});

test("parses an items-only amend, coercing ints", () => {
  const r = parseAmendBody({ items: [item({ priceCents: 1000.4, quantity: 2 })] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.items, [
    { productSlug: "classic", productName: "Classic", quantity: 2, priceCents: 1000, listPriceCents: 1200 },
  ]);
  assert.equal(r.value.collectedCents, undefined);
});

test("parses a $0 price (own bread)", () => {
  const r = parseAmendBody({ items: [item({ priceCents: 0 })] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.items?.[0].priceCents, 0);
});

test("rejects bad items (empty slug, qty<1, negative price)", () => {
  assert.equal(parseAmendBody({ items: [] }).ok, false);
  assert.equal(parseAmendBody({ items: [item({ productSlug: "" })] }).ok, false);
  assert.equal(parseAmendBody({ items: [item({ quantity: 0 })] }).ok, false);
  assert.equal(parseAmendBody({ items: [item({ priceCents: -1 })] }).ok, false);
});

test("parses collectedCents override and null (clear)", () => {
  const set = parseAmendBody({ collectedCents: 999.6 });
  assert.equal(set.ok, true);
  if (set.ok) assert.equal(set.value.collectedCents, 1000);

  const clear = parseAmendBody({ collectedCents: null });
  assert.equal(clear.ok, true);
  if (clear.ok) assert.equal(clear.value.collectedCents, null);
});

test("rejects a negative collectedCents", () => {
  assert.equal(parseAmendBody({ collectedCents: -5 }).ok, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/reservation-amend.test.ts`
Expected: FAIL — cannot find module `./reservation-amend.ts`.

- [ ] **Step 3: Implement the parser**

Create `src/lib/reservation-amend.ts`:

```ts
/**
 * Pure validation/normalization for the reservation "amend pricing" request
 * body. No I/O. Integer cents in, integer cents out. The route layer turns a
 * failure into a 400 and a success into a Sanity patch.
 */

export type AmendItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
  listPriceCents: number;
};

export type AmendInput = {
  items?: AmendItem[];
  collectedCents?: number | null;
};

const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
};

export function parseAmendBody(
  body: unknown,
): { ok: true; value: AmendInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid body." };
  }
  const b = body as Record<string, unknown>;
  const value: AmendInput = {};

  if ("items" in b && b.items !== undefined) {
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return { ok: false, error: "Provide at least one item." };
    }
    const items: AmendItem[] = [];
    for (const raw of b.items) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const productSlug = typeof o.productSlug === "string" ? o.productSlug : "";
      const productName = typeof o.productName === "string" ? o.productName : "";
      const quantity = int(o.quantity);
      const priceCents = int(o.priceCents);
      const listPriceCents = int(o.listPriceCents);
      if (!productSlug || !(quantity >= 1) || !(priceCents >= 0) || !(listPriceCents >= 0)) {
        return { ok: false, error: "An item has an invalid slug, quantity, or price." };
      }
      items.push({ productSlug, productName, quantity, priceCents, listPriceCents });
    }
    value.items = items;
  }

  if ("collectedCents" in b && b.collectedCents !== undefined) {
    if (b.collectedCents === null) {
      value.collectedCents = null;
    } else {
      const c = int(b.collectedCents);
      if (!(c >= 0)) return { ok: false, error: "Collected amount can't be negative." };
      value.collectedCents = c;
    }
  }

  if (value.items === undefined && value.collectedCents === undefined) {
    return { ok: false, error: "Nothing to update." };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/reservation-amend.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservation-amend.ts src/lib/reservation-amend.test.ts
git commit -m "feat(reservations): pure parseAmendBody validator for price/collected amends"
```

---

### Task 3: Schema field + read path carry `collectedCents` (and `dropId` on the list)

**Files:**
- Modify: `src/sanity/schemaTypes/reservation.ts` (add field after `totalCents`)
- Modify: `src/sanity/lib/queries.ts` (`CONFIRMED_RESERVATIONS_FOR_DROP_QUERY`, `RESERVATIONS_QUERY`)
- Modify: `src/lib/bake-list.ts` (`ReservationSource` type)
- Modify: `src/lib/catalog.ts` (`getConfirmedReservationsForDrop` mapper)
- Modify: `src/app/admin/reservations/page.tsx` (`Row` type)

**Interfaces:**
- Consumes: nothing.
- Produces: `ReservationSource.collectedCents?: number`; the admin list `Row` gains `collectedCents?: number` and `dropId?: string`. Used by Tasks 6 (calculator) and 7 (UI).

This task is schema/query/type wiring — verified by `tsc`, not a unit test.

- [ ] **Step 1: Add the schema field**

In `src/sanity/schemaTypes/reservation.ts`, immediately after the `totalCents` field (the line defining `name: "totalCents"`), add:

```ts
    defineField({
      name: "collectedCents",
      title: "Actually collected (cents)",
      type: "number",
      description: "What was really taken in, if different from the total due. Blank = same as total.",
      validation: (r) => r.integer().min(0),
    }),
```

- [ ] **Step 2: Add `collectedCents` to the confirmed-reservations read**

In `src/sanity/lib/queries.ts`, in `CONFIRMED_RESERVATIONS_FOR_DROP_QUERY`, add `collectedCents,` right after the `totalCents,` line so the projection reads:

```groq
      totalCents,
      collectedCents,
      "items": items[]{ productSlug, productName, quantity, priceCents }
```

- [ ] **Step 3: Add `collectedCents` + `dropId` to the admin list read**

In `src/sanity/lib/queries.ts`, in `RESERVATIONS_QUERY`, change the projection block to add `"dropId": drop->_id,` and `collectedCents,`:

```groq
    "id": _id, customerName, customerEmail, customerPhone, channel,
    "dropId": drop->_id, "dropTitle": drop->title, status, totalCents, collectedCents, createdAt, decidedAt,
    promoCode, promoPercentOff, discountedTotalCents,
    items[]{ productSlug, productName, quantity, priceCents }
```

- [ ] **Step 4: Add the field to `ReservationSource`**

In `src/lib/bake-list.ts`, in the `ReservationSource` type, add `collectedCents` after `totalCents`:

```ts
  items: BakeListItem[];
  totalCents: number;
  collectedCents?: number;
};
```

- [ ] **Step 5: Map it in the catalog read**

In `src/lib/catalog.ts`, inside `getConfirmedReservationsForDrop`'s `rows.map((r) => { ... })`, add the field to the returned object (after the `totalCents:` line). A `null`/absent value must NOT become `0`, so guard on `typeof`:

```ts
        totalCents: Number.isFinite(tc) ? tc : 0,
        ...(typeof r.collectedCents === "number" ? { collectedCents: r.collectedCents } : {}),
```

- [ ] **Step 6: Extend the page `Row` type**

In `src/app/admin/reservations/page.tsx`, in the `type Row = { ... }`, add:

```ts
  dropId?: string;
  collectedCents?: number;
```

- [ ] **Step 7: Verify types compile**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/sanity/schemaTypes/reservation.ts src/sanity/lib/queries.ts src/lib/bake-list.ts src/lib/catalog.ts src/app/admin/reservations/page.tsx
git commit -m "feat(reservations): persist + read optional collectedCents (and dropId on admin list)"
```

---

### Task 4: `updateReservationPricing` mutation

**Files:**
- Modify: `src/sanity/lib/mutations.ts` (add exported function near `createInPersonSale`)

**Interfaces:**
- Consumes: the module-local `ReservationItemInput` type (`{ productSlug; productName; quantity; priceCents }`) and `writeClient`.
- Produces: `updateReservationPricing(id: string, input: { items?: ReservationItemInput[]; totalCents?: number; collectedCents?: number | null }): Promise<boolean>` — patches item prices + total and/or sets/clears `collectedCents`. Used by Task 5.

Glue over the Sanity write client — verified by `tsc`. Items carry no array `_key` today, so the whole `items` array is rewritten (mirrors `scripts/zero-reservation.mjs`). When `collectedCents === null`, the field is unset (reverts to total).

- [ ] **Step 1: Add the mutation**

In `src/sanity/lib/mutations.ts`, add after `createInPersonSale`:

```ts
/**
 * Amend a reservation's pricing after the fact: overwrite item prices + total
 * and/or set the actually-collected override. Quantities/status/stock/buyer are
 * never touched here. `collectedCents: null` clears the override (reverts to
 * total). Items are rewritten wholesale because reservation items carry no
 * array `_key`. Returns false when the write client is unconfigured.
 */
export async function updateReservationPricing(
  id: string,
  input: {
    items?: ReservationItemInput[];
    totalCents?: number;
    collectedCents?: number | null;
  },
): Promise<boolean> {
  if (!writeClient || !id) return false;
  const set: Record<string, unknown> = {};
  const unset: string[] = [];

  if (input.items && typeof input.totalCents === "number") {
    set.items = input.items.map((i) => ({ _type: "reservationItem", ...i }));
    set.totalCents = input.totalCents;
  }
  if (input.collectedCents === null) {
    unset.push("collectedCents");
  } else if (typeof input.collectedCents === "number") {
    set.collectedCents = input.collectedCents;
  }

  try {
    let patch = writeClient.patch(id);
    if (Object.keys(set).length > 0) patch = patch.set(set);
    if (unset.length > 0) patch = patch.unset(unset);
    await patch.commit({ autoGenerateArrayKeys: false });
    return true;
  } catch (err) {
    console.error("[reservations] amend pricing failed", id, err);
    return false;
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sanity/lib/mutations.ts
git commit -m "feat(reservations): updateReservationPricing mutation (prices + collected override)"
```

---

### Task 5: Authed dynamic API route `POST /api/admin/reservations/[id]/amend`

**Files:**
- Create: `src/app/api/admin/reservations/[id]/amend/route.ts`

**Interfaces:**
- Consumes: `getAdminSession` (`@/lib/admin-auth`), `parseAmendBody` (`@/lib/reservation-amend`), `computeSaleTotals` (`@/lib/favors`), `updateReservationPricing` (`@/sanity/lib/mutations`).
- Produces: `POST` handler. Request body `{ items?: AmendItem[]; collectedCents?: number | null }`. Responses: `401` unauthenticated, `400` bad body, `503` not configured, `{ ok: true }` success.

Per the Global Constraints, the dynamic param is a promise: `{ params }: { params: Promise<{ id: string }> }`.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/reservations/[id]/amend/route.ts`:

```ts
import { getAdminSession } from "@/lib/admin-auth";
import { computeSaleTotals } from "@/lib/favors";
import { parseAmendBody } from "@/lib/reservation-amend";
import { updateReservationPricing } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return Response.json({ error: "Missing reservation id." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseAmendBody(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  // Recompute the total from amended item prices (same helper the in-person
  // sale form uses); favorsCents is ignored here.
  const totalCents = parsed.value.items
    ? computeSaleTotals(parsed.value.items).totalCents
    : undefined;

  const ok = await updateReservationPricing(id, {
    items: parsed.value.items?.map(({ productSlug, productName, quantity, priceCents }) => ({
      productSlug,
      productName,
      quantity,
      priceCents,
    })),
    totalCents,
    collectedCents: parsed.value.collectedCents,
  });

  if (!ok) {
    return Response.json(
      { error: "Saving isn't configured (no Sanity write token)." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Verify types + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run lint -- src/app/api/admin/reservations/[id]/amend/route.ts`
Expected: no errors for this file (pre-existing `.open-next/` warnings are unrelated and out of scope).

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/reservations/[id]/amend/route.ts"
git commit -m "feat(reservations): authed amend-pricing API route"
```

---

### Task 6: Calculator reads `collectedCents ?? totalCents`

**Files:**
- Modify: `src/app/admin/calculator/page.tsx`

**Interfaces:**
- Consumes: `reservationCollectedCents` (Task 1), `ReservationSource.collectedCents` (Task 3).
- Produces: corrected `actualCollectedCents` (reservations contribute their override when present).

- [ ] **Step 1: Import the helper**

In `src/app/admin/calculator/page.tsx`, change the favors import:

```ts
import { actualFavorsCents, reservationCollectedCents } from "@/lib/favors";
```

- [ ] **Step 2: Use the override in the collected total**

In the same file, change the reservations term of `actualCollectedCents`:

```ts
  const actualCollectedCents =
    orders.reduce((s, o) => s + o.totalCents, 0) +
    reservations.reduce((s, r) => s + reservationCollectedCents(r), 0) +
    charges
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + c.amountCents, 0);
```

(`actualFavorsCents([...orders, ...reservations], listBySlug)` stays exactly as-is — favors remain per-loaf.)

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/calculator/page.tsx
git commit -m "feat(calculator): actually-collected honors reservation collectedCents override"
```

---

### Task 7: Amend UI on `/admin/reservations`

**Files:**
- Create: `src/components/reservation-amend.tsx`
- Modify: `src/app/admin/reservations/page.tsx` (build a drop-lines lookup; render the control on confirmed rows)

**Interfaces:**
- Consumes: the `POST /api/admin/reservations/[id]/amend` route (Task 5); `SaleDrop` lines already built on the page; `Row.dropId`, `Row.collectedCents`, `Row.items`, `Row.totalCents` (Task 3); `formatPrice` (`@/lib/money`).
- Produces: `<ReservationAmend reservationId dropLines items totalCents collectedCents />` client component.

Client component, no unit test in this repo's setup — verified by `tsc`/lint and a manual dev smoke.

- [ ] **Step 1: Create the component**

Create `src/components/reservation-amend.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { formatPrice } from "@/lib/money";

export type AmendDropLine = {
  productSlug: string;
  productName: string;
  listPriceCents: number;
};
type AmendItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};

const dollars = (cents: number) => (cents / 100).toFixed(2);
const toCents = (v: string) => {
  const n = Math.round(Number.parseFloat(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function ReservationAmend({
  reservationId,
  dropLines,
  items,
  totalCents,
  collectedCents,
}: {
  reservationId: string;
  dropLines: AmendDropLine[];
  items: AmendItem[];
  totalCents: number;
  collectedCents?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Editable per-item charged price (cents), keyed by slug.
  const [prices, setPrices] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((it) => [it.productSlug, it.priceCents])),
  );
  const listBySlug = useMemo(
    () => new Map(dropLines.map((l) => [l.productSlug, l.listPriceCents])),
    [dropLines],
  );

  const newTotal = items.reduce(
    (s, it) => s + (prices[it.productSlug] ?? it.priceCents) * it.quantity,
    0,
  );

  // Actually-collected input (cents). Seeded from the override or the total.
  const [collected, setCollected] = useState<number>(collectedCents ?? totalCents);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payloadItems = items.map((it) => {
        const price = prices[it.productSlug] ?? it.priceCents;
        return {
          productSlug: it.productSlug,
          productName: it.productName,
          quantity: it.quantity,
          priceCents: price,
          // List price drives the (server-ignored) favor calc; fall back to the
          // charged price when this loaf isn't in the current drop (favor 0).
          listPriceCents: listBySlug.get(it.productSlug) ?? price,
        };
      });
      // Equal to the recomputed total ⇒ clear the override (null) for clean data.
      const collectedCentsPayload = collected === newTotal ? null : collected;

      const res = await fetch(
        `/api/admin/reservations/${reservationId}/amend`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: payloadItems, collectedCents: collectedCentsPayload }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-outline text-sm">
        Edit prices
      </button>
    );
  }

  return (
    <div className="nb-card mt-3 w-full space-y-3 p-4">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-ink-500">
          <tr>
            <th className="py-2">Loaf</th>
            <th className="py-2">Qty</th>
            <th className="py-2">List</th>
            <th className="py-2">Price each</th>
            <th className="py-2 text-right">Favor</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const price = prices[it.productSlug] ?? it.priceCents;
            const list = listBySlug.get(it.productSlug);
            const favor =
              typeof list === "number" ? it.quantity * Math.max(0, list - price) : 0;
            return (
              <tr key={it.productSlug} className="border-t border-ink/10">
                <td className="py-2 font-semibold">{it.productName}</td>
                <td className="py-2 text-ink-700">{it.quantity}×</td>
                <td className="py-2 text-ink-500">
                  {typeof list === "number" ? formatPrice(list) : "—"}
                </td>
                <td className="py-2">
                  <span className="text-ink-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Price each for ${it.productName}`}
                    value={dollars(price)}
                    onChange={(e) =>
                      setPrices((cur) => ({ ...cur, [it.productSlug]: toCents(e.target.value) }))
                    }
                    className="ml-1 w-20 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
                  />
                </td>
                <td className="py-2 text-right">{favor > 0 ? formatPrice(favor) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm font-semibold" htmlFor={`collected-${reservationId}`}>
          Actually collected{" "}
          <span className="text-ink-500">$</span>
          <input
            id={`collected-${reservationId}`}
            type="number"
            min={0}
            step="0.01"
            value={dollars(collected)}
            onChange={(e) => setCollected(toCents(e.target.value))}
            className="ml-1 w-24 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
          />
        </label>
        <p className="text-sm">
          Total due <strong>{formatPrice(newTotal)}</strong>
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {msg ? <span className="text-xs text-flame-700">{msg}</span> : null}
        <button type="button" onClick={() => setOpen(false)} className="btn-outline text-sm">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="btn-acid text-sm disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the reservations page**

In `src/app/admin/reservations/page.tsx`:

(a) Add the import near the other component imports:

```ts
import { ReservationAmend } from "@/components/reservation-amend";
```

(b) After `saleDrops` is built, add a lookup from drop id → its lines:

```ts
  const linesByDropId = new Map(saleDrops.map((d) => [d.id, d.lines]));
```

(c) Replace the row's action line. Change:

```tsx
              {r.status === "pending" ? <ReservationActions id={r.id} /> : null}
```

to:

```tsx
              {r.status === "pending" ? <ReservationActions id={r.id} /> : null}
              {r.status === "confirmed" ? (
                <ReservationAmend
                  reservationId={r.id}
                  dropLines={linesByDropId.get(r.dropId ?? "") ?? []}
                  items={r.items.map((i) => ({
                    productSlug: i.productSlug,
                    productName: i.productName,
                    quantity: i.quantity,
                    priceCents: i.priceCents,
                  }))}
                  totalCents={r.totalCents}
                  collectedCents={r.collectedCents}
                />
              ) : null}
```

Note: the page `Row.items` projection must expose `productSlug` and `priceCents`. `RESERVATIONS_QUERY` already selects `items[]{ productSlug, productName, quantity, priceCents }`; update the `Row` type's `items` field to match:

```ts
  items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
```

(The existing `itemsLabel`-style render using `i.quantity`/`i.productName` keeps working.)

- [ ] **Step 3: Verify types + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run lint -- src/components/reservation-amend.tsx src/app/admin/reservations/page.tsx`
Expected: no errors for these files.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, log in at `/admin/login`, open `/admin/reservations`. On a **confirmed** reservation, click **Edit prices**, set a loaf to `0` (or any amount), optionally change **Actually collected**, click **Save**. Expected: the list refreshes; re-opening shows the new prices; `/admin/calculator?drop=<that drop>` shows the override in "Actually collected" and the favor in "Favors given (actual)". Stop dev (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add src/components/reservation-amend.tsx src/app/admin/reservations/page.tsx
git commit -m "feat(reservations): edit-prices + actually-collected control on confirmed rows"
```

---

## Self-Review

**1. Spec coverage**
- Data model `collectedCents` → Task 3 (schema) + Task 3 reads. ✔
- Pure recompute via `computeSaleTotals` → reused in Task 5; `reservationCollectedCents` added Task 1. ✔
- `updateReservationPricing` mutation → Task 4. ✔
- Authed `POST .../[id]/amend` route (401/400/503/ok) → Task 5. ✔
- Amend UI on `/admin/reservations` (per-loaf price + favor hint + actually-collected) → Task 7. ✔
- Calculator `collectedCents ?? totalCents`; favors unchanged → Task 6. ✔
- Scope: prices + collected only; no quantity/buyer/stock/status; no new doc type/emails → enforced in Tasks 4/5/7 and Global Constraints. ✔
- Resolved semantics (a) favors per-loaf only, (b) own-bread counts as favor → no extra code needed; favors math untouched (Task 6 note). ✔

**2. Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output. ✔

**3. Type consistency:** `reservationCollectedCents` accepts `{ collectedCents?: number | null; totalCents }` — `ReservationSource.collectedCents?: number` (Task 3) is assignable. `AmendItem` (parser) carries `listPriceCents`; the mutation's `ReservationItemInput` does not — the route strips `listPriceCents` before calling the mutation (Task 5 `.map`). Route param type matches the documented `Promise<{ id: string }>`. UI posts `{ items: [{...priceCents, listPriceCents}], collectedCents }`, which `parseAmendBody` expects. ✔

## Notes for the implementer
- All commits land on a feature branch, not `main` (create one before Task 1 if not already on it).
- The existing `scripts/zero-reservation.mjs` remains as a CLI fallback; this feature supersedes it for the common case.
