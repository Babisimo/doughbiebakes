# Admin Order-Progression Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin advance each paid order and confirmed reservation through New → Baking → Ready → Sent on the existing bake-list page, with an auto on-track/due-soon/behind/done signal derived from the drop's pickup/ship date.

**Architecture:** A new pure `src/lib/fulfillment.ts` owns the `FulfillmentStage` type, transition helpers, and the derived delay logic (unit-tested with `node:test`, zero `server-only`). A new `fulfillmentStatus` Sanity field on `order` + `reservation` (default `"new"`, GROQ-coalesced so zero migration) is threaded through the existing bake-list read path. A concurrency-safe `setFulfillmentStatus` mutation (mirrors `setReservationStatus`) behind an admin-gated POST route, driven by a small client control, all surfaced inline on `/admin/club/[dropId]`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Sanity (GROQ + write client `patch`/`ifRevisionId`), Tailwind v4, `node:test` (`node --test --experimental-strip-types`).

**Spec:** `docs/superpowers/specs/2026-05-17-order-tracker-design.md`

---

## File Structure

- **Create** `src/lib/fulfillment.ts` — pure: `FulfillmentStage`, `STAGES`, `STAGE_LABELS`, `ADVANCE_LABELS`, `isStage`, `coerceStage`, `next`, `prev`, `isAdjacentTransition`, `DelayState`, `deriveDelay`, `DelayCountable`, `summarize`. Zero imports, no `server-only`.
- **Create** `src/lib/__tests__/fulfillment.test.ts` — 10 `node:test` cases.
- **Modify** `src/sanity/schemaTypes/order.ts` + `src/sanity/schemaTypes/reservation.ts` — add `fulfillmentStatus` field.
- **Modify** `src/sanity/lib/queries.ts` — project `id` + coalesced `fulfillmentStatus` in the two bake-list queries.
- **Modify** `src/lib/bake-list.ts` — optional `id`/`fulfillmentStatus` on `OrderSource`/`ReservationSource`; required (coalesced) on `BakeOrderRow`/`BakeReservationRow`.
- **Modify** `src/lib/__tests__/bake-list.test.ts` — 3 passthrough tests.
- **Modify** `src/lib/catalog.ts` — map `id` + `fulfillmentStatus` (via `coerceStage`) in both wrappers.
- **Modify** `src/sanity/lib/mutations.ts` — add `setFulfillmentStatus`.
- **Create** `src/app/api/admin/fulfillment/route.ts` — admin-gated POST.
- **Create** `src/components/fulfillment-control.tsx` — client Advance/Back control.
- **Modify** `src/app/admin/club/[dropId]/page.tsx` — top fulfillment summary + Status column on the two tables.

Baseline: `npm test` currently reports **43 pass / 0 fail**. After Task 1 → **53/0**. After Task 3 → **56/0** (stays 56 through Task 5).

---

### Task 1: Pure `fulfillment.ts` (TDD)

**Files:**
- Create: `src/lib/fulfillment.ts`
- Test: `src/lib/__tests__/fulfillment.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/fulfillment.test.ts` with exactly:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coerceStage,
  deriveDelay,
  isAdjacentTransition,
  isStage,
  next,
  prev,
  summarize,
} from "../fulfillment.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-05-20T12:00:00.000Z");

test("next/prev walk the ladder and saturate at the ends", () => {
  assert.equal(next("new"), "baking");
  assert.equal(next("baking"), "ready");
  assert.equal(next("ready"), "sent");
  assert.equal(next("sent"), null);
  assert.equal(prev("sent"), "ready");
  assert.equal(prev("new"), null);
});

test("isStage / coerceStage", () => {
  assert.equal(isStage("baking"), true);
  assert.equal(isStage("nope"), false);
  assert.equal(isStage(undefined), false);
  assert.equal(coerceStage("ready"), "ready");
  assert.equal(coerceStage("garbage"), "new");
  assert.equal(coerceStage(null), "new");
});

test("isAdjacentTransition: one step either way only", () => {
  assert.equal(isAdjacentTransition("new", "baking"), true);
  assert.equal(isAdjacentTransition("baking", "new"), true);
  assert.equal(isAdjacentTransition("new", "ready"), false);
  assert.equal(isAdjacentTransition("new", "new"), false);
  assert.equal(isAdjacentTransition("new", "nope"), false);
  assert.equal(isAdjacentTransition("x", "baking"), false);
});

test("deriveDelay: sent is always done, even far past the date", () => {
  assert.equal(deriveDelay("sent", "2020-01-01T00:00:00.000Z", now), "done");
});

test("deriveDelay: missing/unparseable date → on-track", () => {
  assert.equal(deriveDelay("new", null, now), "on-track");
  assert.equal(deriveDelay("baking", undefined, now), "on-track");
  assert.equal(deriveDelay("new", "not-a-date", now), "on-track");
});

test("deriveDelay: ready is on-track even past the date", () => {
  assert.equal(
    deriveDelay("ready", "2026-05-19T00:00:00.000Z", now),
    "on-track",
  );
});

test("deriveDelay: past date + new/baking → behind", () => {
  assert.equal(deriveDelay("new", "2026-05-20T00:00:00.000Z", now), "behind");
  assert.equal(
    deriveDelay("baking", "2026-05-19T00:00:00.000Z", now),
    "behind",
  );
});

test("deriveDelay: within 24h (not past) + new/baking → due-soon", () => {
  const soon = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  assert.equal(deriveDelay("new", soon, now), "due-soon");
  assert.equal(deriveDelay("baking", soon, now), "due-soon");
});

test("deriveDelay: comfortably before the date → on-track", () => {
  const later = new Date(now.getTime() + 5 * DAY).toISOString();
  assert.equal(deriveDelay("new", later, now), "on-track");
});

test("summarize: per-stage counts + behind/dueSoon; empty → zeros", () => {
  const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const past = "2026-05-19T00:00:00.000Z";
  const s = summarize(
    [
      { fulfillmentStatus: "new" }, // past → behind
      { fulfillmentStatus: "baking" }, // past → behind
      { fulfillmentStatus: "ready" }, // ready → on-track
      { fulfillmentStatus: "sent" }, // done
    ],
    past,
    now,
  );
  assert.deepEqual(s.byStage, { new: 1, baking: 1, ready: 1, sent: 1 });
  assert.equal(s.behind, 2);
  assert.equal(s.dueSoon, 0);

  const s2 = summarize([{ fulfillmentStatus: "new" }], soon, now);
  assert.equal(s2.dueSoon, 1);
  assert.equal(s2.behind, 0);

  const empty = summarize([], past, now);
  assert.deepEqual(empty.byStage, { new: 0, baking: 0, ready: 0, sent: 0 });
  assert.equal(empty.behind, 0);
  assert.equal(empty.dueSoon, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/__tests__/fulfillment.test.ts`
Expected: FAIL — cannot find module `../fulfillment.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/fulfillment.ts` with exactly (zero imports, no `server-only`):

```ts
export type FulfillmentStage = "new" | "baking" | "ready" | "sent";

export const STAGES: FulfillmentStage[] = ["new", "baking", "ready", "sent"];

export const STAGE_LABELS: Record<FulfillmentStage, string> = {
  new: "New",
  baking: "Baking",
  ready: "Ready",
  sent: "Sent",
};

/** Label for the button that advances FROM this stage. `null` at the end. */
export const ADVANCE_LABELS: Record<FulfillmentStage, string | null> = {
  new: "Start baking",
  baking: "Mark ready",
  ready: "Mark sent",
  sent: null,
};

export function isStage(v: unknown): v is FulfillmentStage {
  return v === "new" || v === "baking" || v === "ready" || v === "sent";
}

export function coerceStage(v: unknown): FulfillmentStage {
  return isStage(v) ? v : "new";
}

export function next(stage: FulfillmentStage): FulfillmentStage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function prev(stage: FulfillmentStage): FulfillmentStage | null {
  const i = STAGES.indexOf(stage);
  return i > 0 ? STAGES[i - 1] : null;
}

export function isAdjacentTransition(from: unknown, to: unknown): boolean {
  if (!isStage(from) || !isStage(to)) return false;
  return next(from) === to || prev(from) === to;
}

export type DelayState = "on-track" | "due-soon" | "behind" | "done";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derived (never stored) lateness. `sent` is always `done`; `ready` is safe
 * even past the date (baked & waiting). Otherwise compare now to the drop's
 * pickup/ship date.
 */
export function deriveDelay(
  stage: FulfillmentStage,
  pickupOrShipDate: string | null | undefined,
  now: Date,
): DelayState {
  if (stage === "sent") return "done";
  if (!pickupOrShipDate) return "on-track";
  const due = new Date(pickupOrShipDate).getTime();
  if (!Number.isFinite(due)) return "on-track";
  if (stage === "ready") return "on-track";
  const t = now.getTime();
  if (t >= due) return "behind";
  if (due - t <= DAY_MS) return "due-soon";
  return "on-track";
}

export type DelayCountable = { fulfillmentStatus: FulfillmentStage };

export function summarize(
  rows: DelayCountable[],
  pickupOrShipDate: string | null | undefined,
  now: Date,
): { byStage: Record<FulfillmentStage, number>; behind: number; dueSoon: number } {
  const byStage: Record<FulfillmentStage, number> = {
    new: 0,
    baking: 0,
    ready: 0,
    sent: 0,
  };
  let behind = 0;
  let dueSoon = 0;
  for (const r of rows) {
    byStage[r.fulfillmentStatus] += 1;
    const d = deriveDelay(r.fulfillmentStatus, pickupOrShipDate, now);
    if (d === "behind") behind += 1;
    else if (d === "due-soon") dueSoon += 1;
  }
  return { byStage, behind, dueSoon };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/__tests__/fulfillment.test.ts`
Expected: PASS — `tests 10 ... pass 10 ... fail 0`.

- [ ] **Step 5: Full suite + typecheck + lint**

- `npm test` → `tests 53 ... pass 53 ... fail 0`
- `npm run typecheck` → exit 0, no output
- `npm run lint` → exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/fulfillment.ts src/lib/__tests__/fulfillment.test.ts
git commit -m "feat: pure fulfillment stage + delay helpers (tested)"
```
(Append the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` via HEREDOC.)

---

### Task 2: `fulfillmentStatus` Sanity field on order + reservation

**Files:**
- Modify: `src/sanity/schemaTypes/order.ts`
- Modify: `src/sanity/schemaTypes/reservation.ts`

- [ ] **Step 1: Add the field to `order.ts`**

In `src/sanity/schemaTypes/order.ts`, find this line (the `createdAt` field, the last entry in the `fields` array):

```ts
    defineField({ name: "createdAt", title: "Created at", type: "datetime", readOnly: true, validation: (r) => r.required() }),
```

Insert immediately AFTER it (still inside the `fields: [ ... ]` array, before the closing `]`):

```ts
    defineField({
      name: "fulfillmentStatus",
      title: "Fulfillment status",
      type: "string",
      options: {
        list: [
          { title: "New", value: "new" },
          { title: "Baking", value: "baking" },
          { title: "Ready", value: "ready" },
          { title: "Sent", value: "sent" },
        ],
        layout: "radio",
      },
      initialValue: "new",
    }),
```

(No `validation.required()` — legacy docs without the field stay valid; reads coalesce to `"new"`.)

- [ ] **Step 2: Add the field to `reservation.ts`**

In `src/sanity/schemaTypes/reservation.ts`, find this line (the `decidedAt` field, the last entry in the `fields` array):

```ts
    defineField({ name: "decidedAt", title: "Decided at", type: "datetime", readOnly: true }),
```

Insert immediately AFTER it (before the closing `]` of `fields`):

```ts
    defineField({
      name: "fulfillmentStatus",
      title: "Fulfillment status",
      type: "string",
      options: {
        list: [
          { title: "New", value: "new" },
          { title: "Baking", value: "baking" },
          { title: "Ready", value: "ready" },
          { title: "Sent", value: "sent" },
        ],
        layout: "radio",
      },
      initialValue: "new",
    }),
```

- [ ] **Step 3: Typecheck + lint + build**

- `npm run typecheck` → exit 0, no output
- `npm run lint` → exit 0
- `npm run build` → success (Sanity schema compiles into the Studio route)

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/order.ts src/sanity/schemaTypes/reservation.ts
git commit -m "feat: add fulfillmentStatus field to order + reservation schemas"
```

---

### Task 3: Thread `id` + `fulfillmentStatus` through the read path

**Files:**
- Modify: `src/sanity/lib/queries.ts`
- Modify: `src/lib/bake-list.ts`
- Modify: `src/lib/catalog.ts`
- Test: `src/lib/__tests__/bake-list.test.ts`

- [ ] **Step 1: Add the failing bake-list passthrough tests**

In `src/lib/__tests__/bake-list.test.ts`, append these 3 tests at the END of the file:

```ts
test("order row carries id + fulfillmentStatus passthrough", () => {
  const v = buildBakeListView(
    base({
      orders: [
        {
          id: "order.cs_1",
          fulfillmentStatus: "baking",
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [{ productSlug: "classic", productName: "Classic Sourdough", quantity: 1 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 1100,
        },
      ],
    }),
  );
  assert.equal(v.orders[0].id, "order.cs_1");
  assert.equal(v.orders[0].fulfillmentStatus, "baking");
});

test("reservation row carries id + fulfillmentStatus passthrough", () => {
  const v = buildBakeListView(
    base({
      reservations: [
        {
          id: "resv_9",
          fulfillmentStatus: "ready",
          customerEmail: "d@x.com",
          customerName: "Dee",
          customerPhone: "556",
          items: [{ productSlug: "jalapeno", productName: "Jalapeño Cheddar", quantity: 2 }],
          totalCents: 2400,
        },
      ],
    }),
  );
  assert.equal(v.reservations[0].id, "resv_9");
  assert.equal(v.reservations[0].fulfillmentStatus, "ready");
});

test("absent id/fulfillmentStatus default to '' and 'new'", () => {
  const v = buildBakeListView(
    base({
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [{ productSlug: "classic", productName: "Classic Sourdough", quantity: 1 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 1100,
        },
      ],
      reservations: [
        {
          customerEmail: "d@x.com",
          customerName: "Dee",
          customerPhone: "556",
          items: [{ productSlug: "jalapeno", productName: "Jalapeño Cheddar", quantity: 1 }],
          totalCents: 1200,
        },
      ],
    }),
  );
  assert.equal(v.orders[0].id, "");
  assert.equal(v.orders[0].fulfillmentStatus, "new");
  assert.equal(v.reservations[0].id, "");
  assert.equal(v.reservations[0].fulfillmentStatus, "new");
});
```

- [ ] **Step 2: Run them to verify failure**

Run: `node --test --experimental-strip-types src/lib/__tests__/bake-list.test.ts`
Expected: FAIL — `v.orders[0].id` / `.fulfillmentStatus` are `undefined` (fields not yet added).

- [ ] **Step 3: Add `id` + `fulfillmentStatus` to `bake-list.ts`**

In `src/lib/bake-list.ts`, add this as the FIRST line of the file (before `export type BakeListItem`):

```ts
import type { FulfillmentStage } from "./fulfillment.ts";
```

Replace the `OrderSource` type with:

```ts
export type OrderSource = {
  id?: string;
  fulfillmentStatus?: FulfillmentStage;
  customerEmail: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: BakeListItem[];
  fulfillment: "pickup" | "ship";
  shipAddress?: BakeOrderShipAddress | null;
  totalCents: number;
};
```

Replace the `ReservationSource` type with:

```ts
export type ReservationSource = {
  id?: string;
  fulfillmentStatus?: FulfillmentStage;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  items: BakeListItem[];
  totalCents: number;
};
```

Replace the `BakeOrderRow` type with:

```ts
export type BakeOrderRow = {
  id: string;
  fulfillmentStatus: FulfillmentStage;
  email: string;
  name: string | null;
  phone: string | null;
  items: { slug: string; name: string; qty: number }[];
  fulfillment: "pickup" | "ship";
  shipAddress: BakeOrderShipAddress | null;
  totalCents: number;
};
```

Replace the `BakeReservationRow` type with:

```ts
export type BakeReservationRow = {
  id: string;
  fulfillmentStatus: FulfillmentStage;
  email: string;
  name: string;
  phone: string;
  items: { slug: string; name: string; qty: number }[];
  totalCents: number;
};
```

In `buildBakeListView`, replace the `orderRows` block with:

```ts
  const orderRows: BakeOrderRow[] = orders.map((o) => {
    for (const it of o.items) add(it.productSlug, it.quantity, it.productName);
    return {
      id: o.id ?? "",
      fulfillmentStatus: o.fulfillmentStatus ?? "new",
      email: o.customerEmail,
      name: o.customerName ?? null,
      phone: o.customerPhone ?? null,
      items: mapItems(o.items),
      fulfillment: o.fulfillment,
      shipAddress: o.shipAddress ?? null,
      totalCents: o.totalCents,
    };
  });
```

And replace the `reservationRows` block with:

```ts
  const reservationRows: BakeReservationRow[] = reservations.map((r) => {
    for (const it of r.items) add(it.productSlug, it.quantity, it.productName);
    return {
      id: r.id ?? "",
      fulfillmentStatus: r.fulfillmentStatus ?? "new",
      email: r.customerEmail,
      name: r.customerName,
      phone: r.customerPhone,
      items: mapItems(r.items),
      totalCents: r.totalCents,
    };
  });
```

(`import type` is erased by `node --experimental-strip-types`, so the existing bake-list tests still run; `fulfillment.ts` is itself a pure node:test-clean module. The new fields are optional on the `*Source` inputs so the existing test fixtures still typecheck.)

- [ ] **Step 4: Run bake-list tests green**

Run: `node --test --experimental-strip-types src/lib/__tests__/bake-list.test.ts`
Expected: PASS — `tests 12 ... pass 12 ... fail 0`.

- [ ] **Step 5: Project `id` + coalesced `fulfillmentStatus` in the queries**

In `src/sanity/lib/queries.ts`, replace `LIVE_ORDERS_FOR_DROP_QUERY` with:

```ts
export const LIVE_ORDERS_FOR_DROP_QUERY = groq`
  *[_type == "order" && drop._ref == $dropId && livemode == true]
    | order(createdAt asc){
      "id": _id,
      "fulfillmentStatus": coalesce(fulfillmentStatus, "new"),
      "customerEmail": customerEmail,
      "customerName": customerName,
      "customerPhone": customerPhone,
      fulfillment,
      "shipAddress": shipAddress{ line1, line2, city, state, postalCode },
      totalCents,
      "items": items[]{ productSlug, productName, quantity }
    }`;
```

Replace `CONFIRMED_RESERVATIONS_FOR_DROP_QUERY` with:

```ts
export const CONFIRMED_RESERVATIONS_FOR_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId && status == "confirmed"]
    | order(createdAt asc){
      "id": _id,
      "fulfillmentStatus": coalesce(fulfillmentStatus, "new"),
      "customerEmail": customerEmail,
      "customerName": customerName,
      "customerPhone": customerPhone,
      totalCents,
      "items": items[]{ productSlug, productName, quantity }
    }`;
```

- [ ] **Step 6: Map the new fields in `catalog.ts`**

In `src/lib/catalog.ts`, add this import next to the other local imports (the line `import { dropRecencyKey, effectiveDropStatus, isCurrentDrop, isPreviousDrop } from "./drop-status";` already exists — add below it):

```ts
import { coerceStage } from "./fulfillment";
```

In `getLiveOrdersForDrop`, inside `rows.map`, replace the returned object with (adds `id` + `fulfillmentStatus` as the first two fields, everything else unchanged):

```ts
      return ({
        id: typeof r.id === "string" ? r.id : "",
        fulfillmentStatus: coerceStage(r.fulfillmentStatus),
        customerEmail: typeof r.customerEmail === "string" ? r.customerEmail : "",
        customerName: typeof r.customerName === "string" ? r.customerName : null,
        customerPhone: typeof r.customerPhone === "string" ? r.customerPhone : null,
        items: normItems(r.items),
        fulfillment: r.fulfillment === "ship" ? "ship" : "pickup",
        shipAddress: (r.shipAddress as OrderSource["shipAddress"]) ?? null,
        totalCents: Number.isFinite(tc) ? tc : 0,
      });
```

In `getConfirmedReservationsForDrop`, inside `rows.map`, replace the returned object with:

```ts
      return ({
        id: typeof r.id === "string" ? r.id : "",
        fulfillmentStatus: coerceStage(r.fulfillmentStatus),
        customerEmail: typeof r.customerEmail === "string" ? r.customerEmail : "",
        customerName: typeof r.customerName === "string" ? r.customerName : "",
        customerPhone: typeof r.customerPhone === "string" ? r.customerPhone : "",
        items: normItems(r.items),
        totalCents: Number.isFinite(tc) ? tc : 0,
      });
```

- [ ] **Step 7: Full verify**

- `npm test` → `tests 56 ... pass 56 ... fail 0`
- `npm run typecheck` → exit 0, no output
- `npm run lint` → exit 0
- `npm run build` → success; `/admin/club/[dropId]` route present

- [ ] **Step 8: Commit**

```bash
git add src/sanity/lib/queries.ts src/lib/bake-list.ts src/lib/catalog.ts src/lib/__tests__/bake-list.test.ts
git commit -m "feat: thread order/reservation id + fulfillmentStatus through bake-list read path"
```

---

### Task 4: `setFulfillmentStatus` mutation + admin API route

**Files:**
- Modify: `src/sanity/lib/mutations.ts`
- Create: `src/app/api/admin/fulfillment/route.ts`

- [ ] **Step 1: Add `setFulfillmentStatus` to `mutations.ts`**

Append at the END of `src/sanity/lib/mutations.ts`:

```ts
/**
 * Concurrency-safe fulfillment-stage transition. Verifies the doc is still at
 * `fromStatus` (and, for reservations, still `confirmed`), then patches with
 * `ifRevisionId`. Mirrors `setReservationStatus`: a 409 revision conflict is
 * an idempotent no-op (`{ ok:false, conflict:true }`); real errors re-throw.
 */
export async function setFulfillmentStatus(
  type: "order" | "reservation",
  id: string,
  fromStatus: string,
  toStatus: string,
): Promise<{ ok: boolean; conflict?: boolean }> {
  if (!writeClient) return { ok: false };
  const docType = type === "order" ? "order" : "reservation";
  const cur = await writeClient.fetch<
    { _rev: string; fulfillmentStatus?: string; status?: string } | null
  >(
    `*[_type == $docType && _id == $id][0]{ _rev, fulfillmentStatus, status }`,
    { docType, id },
  );
  if (!cur) return { ok: false };
  if (type === "reservation" && cur.status !== "confirmed") {
    return { ok: false };
  }
  const curStage = cur.fulfillmentStatus ?? "new";
  if (curStage !== fromStatus) return { ok: false, conflict: true };
  try {
    await writeClient
      .patch(id)
      .ifRevisionId(cur._rev)
      .set({ fulfillmentStatus: toStatus })
      .commit();
    return { ok: true };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return { ok: false, conflict: true };
    }
    throw err;
  }
}
```

- [ ] **Step 2: Create the admin route**

Create `src/app/api/admin/fulfillment/route.ts` with exactly:

```ts
import { getAdminSession } from "@/lib/admin-auth";
import { isAdjacentTransition, isStage } from "@/lib/fulfillment";
import { setFulfillmentStatus } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { type?: unknown; id?: unknown; from?: unknown; to?: unknown };
  try {
    body = (await req.json()) as {
      type?: unknown;
      id?: unknown;
      from?: unknown;
      to?: unknown;
    };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const type =
    body.type === "order" || body.type === "reservation" ? body.type : null;
  const id = typeof body.id === "string" ? body.id : "";
  const { from, to } = body;
  if (!type || !id || !isStage(from) || !isStage(to)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (!isAdjacentTransition(from, to)) {
    return Response.json(
      { error: "Non-adjacent transition." },
      { status: 409 },
    );
  }
  const r = await setFulfillmentStatus(type, id, from, to);
  if (!r.ok) {
    return Response.json(
      { ok: false, conflict: r.conflict ?? false },
      { status: r.conflict ? 409 : 400 },
    );
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Verify**

- `npm run typecheck` → exit 0, no output
- `npm run lint` → exit 0
- `npm run build` → success; `/api/admin/fulfillment` route present in build output
- `npm test` → `tests 56 ... pass 56 ... fail 0` (unchanged — no test files touched)

- [ ] **Step 4: Commit**

```bash
git add src/sanity/lib/mutations.ts "src/app/api/admin/fulfillment/route.ts"
git commit -m "feat: concurrency-safe setFulfillmentStatus mutation + admin route"
```

---

### Task 5: Client control + bake-list page wiring

**Files:**
- Create: `src/components/fulfillment-control.tsx`
- Modify: `src/app/admin/club/[dropId]/page.tsx`

- [ ] **Step 1: Create the client control**

Create `src/components/fulfillment-control.tsx` with exactly:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ADVANCE_LABELS,
  next,
  prev,
  type FulfillmentStage,
} from "@/lib/fulfillment";

export function FulfillmentControl({
  type,
  id,
  from,
}: {
  type: "order" | "reservation";
  id: string;
  from: FulfillmentStage;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function move(to: FulfillmentStage | null) {
    if (!to || busy || !id) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/fulfillment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, id, from, to }),
      });
      const data = (await res.json()) as { ok?: boolean; conflict?: boolean };
      if (!res.ok || !data.ok) {
        // Conflict = the page was stale; just refresh to show truth.
        if (!data.conflict) setMsg("Failed.");
        router.refresh();
        setBusy(false);
        return;
      }
      router.refresh();
      setBusy(false);
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  const fwd = next(from);
  const back = prev(from);
  const advanceLabel = ADVANCE_LABELS[from];

  return (
    <div className="flex items-center gap-2">
      {back ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => move(back)}
          className="btn-outline text-xs"
          title={`Back to ${back}`}
        >
          ‹
        </button>
      ) : null}
      {fwd && advanceLabel ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => move(fwd)}
          className="btn-acid text-xs"
        >
          {advanceLabel}
        </button>
      ) : null}
      {msg ? <span className="text-xs text-flame-700">{msg}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: Replace the entire `page.tsx`**

Read `src/app/admin/club/[dropId]/page.tsx` first, then overwrite the whole file with exactly:

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { buildBakeListView } from "@/lib/bake-list";
import { getAdminSession } from "@/lib/admin-auth";
import {
  getActiveDrop,
  getConfirmedReservationsForDrop,
  getLiveOrdersForDrop,
  getMemberSelectionsForDrop,
  getPendingReservationCountForDrop,
} from "@/lib/catalog";
import {
  deriveDelay,
  STAGE_LABELS,
  summarize,
  type DelayState,
  type FulfillmentStage,
} from "@/lib/fulfillment";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { FulfillmentControl } from "@/components/fulfillment-control";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bake list",
  robots: { index: false, follow: false },
};

type StripeCustomerSummary = {
  name: string | null;
  phone: string | null;
  address: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
  } | null;
};

function formatDate(value?: string) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function itemsLabel(items: { name: string; qty: number }[]) {
  return items.map((i) => `${i.qty}× ${i.name}`).join(", ");
}

function stageBadgeClass(s: FulfillmentStage) {
  if (s === "baking") return "badge badge-acid";
  if (s === "ready") return "badge badge-sage";
  return "badge";
}

function DelayChip({ d }: { d: DelayState }) {
  if (d === "behind")
    return (
      <span className="ml-2 text-xs font-bold text-flame-700">⚠ BEHIND</span>
    );
  if (d === "due-soon")
    return (
      <span className="ml-2 text-xs font-semibold text-acid-600">
        ⚠ due soon
      </span>
    );
  if (d === "done")
    return <span className="ml-2 text-xs text-ink-500">✓ done</span>;
  return null;
}

export default async function BakeListPage({
  params,
}: {
  params: Promise<{ dropId: string }>;
}) {
  const { dropId } = await params;

  if (!(await getAdminSession())) {
    redirect(`/admin/login?next=/admin/club/${encodeURIComponent(dropId)}`);
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id !== dropId) notFound();

  const [selections, orders, reservations, pendingReservationCount] =
    await Promise.all([
      getMemberSelectionsForDrop(drop, { fresh: true }),
      getLiveOrdersForDrop(drop.id, { fresh: true }),
      getConfirmedReservationsForDrop(drop.id, { fresh: true }),
      getPendingReservationCountForDrop(drop.id, { fresh: true }),
    ]);

  const view = buildBakeListView({
    drop,
    members: selections,
    orders,
    reservations,
    pendingReservationCount,
  });

  const now = new Date();
  const fSummary = summarize(
    [...view.orders, ...view.reservations],
    drop.pickupOrShipDate,
    now,
  );
  const trackedCount = view.orders.length + view.reservations.length;

  const stripe = getStripe();
  const enriched = await Promise.all(
    selections.map(async (sel) => {
      let customer: StripeCustomerSummary | null = null;
      if (stripe) {
        try {
          const list = await stripe.customers.list({
            email: sel.customerEmail,
            limit: 1,
          });
          const c = list.data[0];
          if (c) {
            customer = {
              name: c.name ?? null,
              phone: c.phone ?? null,
              address: c.shipping?.address ?? null,
            };
          }
        } catch (err) {
          console.error("[admin/club] Stripe lookup failed:", err);
        }
      }
      return { ...sel, customer };
    }),
  );

  const productNameBySlug = new Map(
    drop.lineItems.map((li) => [li.product.slug, li.product.name]),
  );
  const pickupCount = selections.filter(
    (s) => (s.fulfillment ?? "pickup") === "pickup",
  ).length;
  const shipCount = selections.length - pickupCount;

  const pickupLabel = formatDate(drop.pickupOrShipDate);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
            Admin · Bake list
          </p>
          <h1 className="display mt-1 text-4xl sm:text-5xl">{drop.title}</h1>
          <p className="mt-2 text-ink-700">
            Status: <strong>{drop.status}</strong>
            {pickupLabel ? ` · Pickup / ship: ${pickupLabel}` : ""}
          </p>
        </div>
        <form method="POST" action="/api/admin/logout">
          <button
            type="submit"
            className="text-xs font-bold text-acid-600 underline decoration-2 hover:no-underline"
          >
            Log out
          </button>
        </form>
      </div>

      <section className="mt-8">
        <h2 className="display text-2xl">
          Bake totals — {view.counts.loaves} loaf
          {view.counts.loaves === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Everything for this drop: {view.counts.members} member
          {view.counts.members === 1 ? "" : "s"} · {view.counts.orders} public
          order{view.counts.orders === 1 ? "" : "s"} ·{" "}
          {view.counts.reservations} confirmed reservation
          {view.counts.reservations === 1 ? "" : "s"}.
        </p>
        {trackedCount > 0 ? (
          <p className="mt-2 text-sm text-ink-700">
            Fulfillment: {fSummary.byStage.new} new · {fSummary.byStage.baking}{" "}
            baking · {fSummary.byStage.ready} ready · {fSummary.byStage.sent}{" "}
            sent
            {fSummary.behind > 0 || fSummary.dueSoon > 0 ? (
              <>
                {" — "}
                {fSummary.behind > 0 ? (
                  <strong className="text-flame-700">
                    ⚠ {fSummary.behind} behind
                  </strong>
                ) : null}
                {fSummary.behind > 0 && fSummary.dueSoon > 0 ? ", " : ""}
                {fSummary.dueSoon > 0 ? (
                  <strong className="text-acid-600">
                    {fSummary.dueSoon} due soon
                  </strong>
                ) : null}
              </>
            ) : null}
          </p>
        ) : null}
        {view.totals.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            Nobody&apos;s picked yet. Member picks, public orders, and confirmed
            reservations for this drop will tally up here.
          </p>
        ) : (
          <ul className="nb-card mt-4 divide-y divide-ink/10 p-0">
            {view.totals.map((t) => (
              <li
                key={t.slug}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="font-semibold">
                  {t.name}
                  {!t.inDrop ? (
                    <span className="ml-2 align-middle text-xs font-normal text-flame-700">
                      (not in this drop)
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-bold text-ink">bake {t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl">Members ({view.counts.members})</h2>

        {selections.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            Nobody&apos;s picked yet. Once members open their magic links and
            choose a flavor, they&apos;ll appear here.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-700">
              <strong>{pickupCount}</strong> local pickup ·{" "}
              <strong>{shipCount}</strong> shipping
              {shipCount > 0
                ? ` · ${formatPrice(shipCount * site.breadClub.shipSurchargeCents)} shipping auto-billed on next invoices`
                : ""}
            </p>
            <div className="nb-card mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Flavor</th>
                    <th className="px-4 py-3">Get it via</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((row) => {
                    const a = row.customer?.address;
                    const fulfillment = row.fulfillment ?? "pickup";
                    return (
                      <tr
                        key={row.customerEmail}
                        className="border-b border-ink/10 align-top last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold">
                            {row.customer?.name ?? "(no name on Stripe)"}
                          </div>
                          <div className="text-ink-700">{row.customerEmail}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {productNameBySlug.get(row.productSlug) ??
                            row.productSlug}
                          {row.source === "default" ? (
                            <span className="ml-2 align-middle text-xs font-normal text-ink-500">
                              (default — never picked)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {fulfillment === "pickup" ? (
                            <span className="badge badge-sage">📍 Pickup</span>
                          ) : (
                            <span className="badge badge-flame">📦 Ship</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {row.customer?.phone ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {fulfillment === "pickup" ? (
                            <span className="text-ink-500">
                              Local pickup — no address needed
                            </span>
                          ) : a ? (
                            <address className="not-italic">
                              {a.line1}
                              {a.line2 ? (
                                <>
                                  <br />
                                  {a.line2}
                                </>
                              ) : null}
                              <br />
                              {[a.city, a.state, a.postal_code]
                                .filter(Boolean)
                                .join(", ")}
                            </address>
                          ) : (
                            <span className="text-flame-700">
                              ⚠ Wants shipping but no address on Stripe
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl">
          Public orders ({view.counts.orders})
        </h2>
        {view.orders.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            No paid public orders for this drop yet.
          </p>
        ) : (
          <div className="nb-card mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Get it via</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Where</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.orders.map((o, i) => {
                  const d = deriveDelay(
                    o.fulfillmentStatus,
                    drop.pickupOrShipDate,
                    now,
                  );
                  return (
                    <tr
                      key={o.id || `${o.email}-${i}`}
                      className="border-b border-ink/10 align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {o.name ?? "(no name)"}
                        </div>
                        <div className="text-ink-700">
                          {o.email || "(no email)"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {itemsLabel(o.items)}
                        </div>
                        <div className="text-ink-500">
                          {formatPrice(o.totalCents)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {o.fulfillment === "pickup" ? (
                          <span className="badge badge-sage">📍 Pickup</span>
                        ) : (
                          <span className="badge badge-flame">📦 Ship</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {o.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {o.fulfillment === "pickup" ? (
                          <span className="text-ink-500">
                            Local pickup — no address needed
                          </span>
                        ) : o.shipAddress ? (
                          <address className="not-italic">
                            {o.shipAddress.line1}
                            {o.shipAddress.line2 ? (
                              <>
                                <br />
                                {o.shipAddress.line2}
                              </>
                            ) : null}
                            <br />
                            {[
                              o.shipAddress.city,
                              o.shipAddress.state,
                              o.shipAddress.postalCode,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </address>
                        ) : (
                          <span className="text-flame-700">
                            ⚠ Wants shipping but no address on order
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span>
                            <span className={stageBadgeClass(o.fulfillmentStatus)}>
                              {STAGE_LABELS[o.fulfillmentStatus]}
                            </span>
                            <DelayChip d={d} />
                          </span>
                          {o.id ? (
                            <FulfillmentControl
                              type="order"
                              id={o.id}
                              from={o.fulfillmentStatus}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl">
          Confirmed reservations ({view.counts.reservations})
        </h2>
        {view.pendingReservationCount > 0 ? (
          <p className="mt-2 text-sm text-flame-700">
            {view.pendingReservationCount} pending reservation
            {view.pendingReservationCount === 1 ? "" : "s"} not counted yet —
            review at{" "}
            <a
              className="underline decoration-2 hover:no-underline"
              href="/admin/reservations"
            >
              /admin/reservations
            </a>
            .
          </p>
        ) : null}
        {view.reservations.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            No confirmed reservations for this drop yet.
          </p>
        ) : (
          <div className="nb-card mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Reserved</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Due at pickup</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.reservations.map((r, i) => {
                  const d = deriveDelay(
                    r.fulfillmentStatus,
                    drop.pickupOrShipDate,
                    now,
                  );
                  return (
                    <tr
                      key={r.id || `${r.email}-${i}`}
                      className="border-b border-ink/10 align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {r.name || "(no name)"}
                        </div>
                        <div className="text-ink-700">
                          {r.email || "(no email)"}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {itemsLabel(r.items)}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {r.phone || "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {formatPrice(r.totalCents)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span>
                            <span className={stageBadgeClass(r.fulfillmentStatus)}>
                              {STAGE_LABELS[r.fulfillmentStatus]}
                            </span>
                            <DelayChip d={d} />
                          </span>
                          {r.id ? (
                            <FulfillmentControl
                              type="reservation"
                              id={r.id}
                              from={r.fulfillmentStatus}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

- `npm run typecheck` → exit 0, no output (confirms `BakeOrderRow`/`BakeReservationRow` now expose `id`/`fulfillmentStatus`, `summarize` accepts `[...view.orders, ...view.reservations]`, and `FulfillmentControl`'s `from` prop is `FulfillmentStage`).
- `npm run lint` → exit 0
- `npm run build` → success; `/admin/club/[dropId]` route present
- `npm test` → `tests 56 ... pass 56 ... fail 0` (unchanged)

- [ ] **Step 4: Commit**

```bash
git add src/components/fulfillment-control.tsx "src/app/admin/club/[dropId]/page.tsx"
git commit -m "feat: inline fulfillment tracker on the bake list (status + delay + controls)"
```

- [ ] **Step 5: Manual verification note (for the human/reviewer)**

Needs a logged-in admin + live Sanity data; cannot be unit-tested. After deploy, at `/admin/club/<active-drop-id>`: each Public order / Confirmed reservation row shows a stage badge + Advance/Back; advancing persists and survives reload; the top "Fulfillment:" line and the ⚠ behind / due-soon counts match the rows given the drop's pickup/ship date; a stale tab that advances a row already moved elsewhere silently refreshes (no error). State explicitly that this is a manual check.

---

## Self-Review

**1. Spec coverage:**
- Pure `fulfillment.ts` (FulfillmentStage, STAGES, labels, next/prev, isStage/coerceStage, isAdjacentTransition, deriveDelay, summarize) + 10 `node:test` → Task 1. ✓
- `fulfillmentStatus` field on order + reservation, `initialValue:"new"`, no required() → Task 2; zero-migration via GROQ `coalesce(...,"new")` → Task 3 Step 5. ✓
- Tracked sources = orders + confirmed reservations only (members untouched); the CONFIRMED query already filters `status=="confirmed"`; members section unchanged in the page literal. ✓
- Stages New→Baking→Ready→Sent; adjacency-guarded, `ifRevisionId`, reservation requires `status=="confirmed"` → Task 4. ✓
- Derived delay (sent→done, ready safe past date, missing date→on-track, past→behind, ≤24h→due-soon) → Task 1 `deriveDelay` + page `DelayChip`/`deriveDelay` calls. ✓
- Inline UI: top summary line (Task 5 page, gated on `trackedCount>0`), Status column with badge + chip + control on both tables; members/Bake-totals/rest unchanged. ✓
- Error handling: demo-mode (`setFulfillmentStatus`→`{ok:false}`, controls only render when `o.id`/`r.id` truthy, which is `""` in demo), conflict no-op + refresh, legacy coalesce, API 400/401/409 validation, no `pickupOrShipDate`→on-track, network error inline. ✓
- Out of scope (customer-facing, member progression, behind-first sort, per-item due dates, the order→drop attribution bug) → untouched. ✓

**2. Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Every code step is complete literal content.

**3. Type consistency:** `FulfillmentStage` defined once in `fulfillment.ts`; `bake-list.ts` `import type`s it; `BakeOrderRow.fulfillmentStatus`/`BakeReservationRow.fulfillmentStatus` are `FulfillmentStage`; `summarize`'s `DelayCountable` = `{fulfillmentStatus: FulfillmentStage}` and `[...view.orders, ...view.reservations]` satisfies it; `FulfillmentControl.from: FulfillmentStage` is fed `o.fulfillmentStatus`/`r.fulfillmentStatus`; the route validates with `isStage` (narrows `unknown`→`FulfillmentStage`) before `setFulfillmentStatus(type,id,from,to)` (string params — `FulfillmentStage` assignable); `coerceStage` (catalog) and `isStage`/`isAdjacentTransition` (route) all imported from `@/lib/fulfillment` / `./fulfillment`. GROQ projects `"id": _id` + `"fulfillmentStatus": coalesce(...,"new")` matching the catalog `r.id`/`r.fulfillmentStatus` reads and the optional `OrderSource`/`ReservationSource` fields. Test counts: 43 → 53 (Task 1) → 56 (Task 3, +3 bake-list; single-file bake-list 9→12). Consistent.
