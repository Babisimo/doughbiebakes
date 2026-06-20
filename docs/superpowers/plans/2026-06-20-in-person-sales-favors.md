# In-Person Sales & Favors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the baker log in-person sales (name-only buyer, per-loaf favor pricing) as confirmed reservations from `/admin/reservations`, and show real favors given on the ROI calculator.

**Architecture:** Reuse the existing `reservation` document (confirmed + a new `channel: "in-person"`). A pure helper computes sale totals and favors. The new admin form posts to a new API route that calls a new `createInPersonSale` mutation, which decrements drop stock. Confirmed reservations already flow into the bake list and "Actually collected"; the calculator gains a read-only "Favors given (actual)" metric derived from real per-item prices.

**Tech Stack:** Next.js 16 (App Router), React 19, Sanity v5, TypeScript. Tests: `node:test` + `node:assert/strict`, run with `npm test` (`node --test --experimental-strip-types`). Test imports use explicit `.ts` extensions.

## Global Constraints

- All money is integer **cents**.
- This is a modified Next.js — consult `node_modules/next/dist/docs/` before using framework APIs.
- Admin routes/pages gate on `getAdminSession()` from `@/lib/admin-auth` and use `export const runtime = "nodejs"`.
- Test files import source with explicit `.ts` extension (e.g. `from "./favors.ts"`).
- Mutations no-op safely when `writeClient` is unconfigured (return `null`/`false`).
- Follow existing file style; keep new files small and single-responsibility.

---

### Task 1: Pure favor/total math (`src/lib/favors.ts`)

**Files:**
- Create: `src/lib/favors.ts`
- Test: `src/lib/favors.test.ts`

**Interfaces:**
- Produces:
  - `type SaleLineInput = { productSlug: string; productName: string; quantity: number; priceCents: number; listPriceCents: number }`
  - `computeSaleTotals(items: SaleLineInput[]): { totalCents: number; favorsCents: number }`
  - `type SoldItem = { productSlug: string; quantity: number; priceCents?: number }`
  - `type SoldSource = { items: SoldItem[] }`
  - `actualFavorsCents(sources: SoldSource[], listPriceBySlug: Map<string, number>): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/favors.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actualFavorsCents,
  computeSaleTotals,
  type SaleLineInput,
  type SoldSource,
} from "./favors.ts";

function sale(over: Partial<SaleLineInput> = {}): SaleLineInput {
  return {
    productSlug: over.productSlug ?? "classic",
    productName: over.productName ?? "Classic",
    quantity: over.quantity ?? 1,
    priceCents: over.priceCents ?? 1200,
    listPriceCents: over.listPriceCents ?? 1200,
    ...over,
  };
}

test("computeSaleTotals: full price has no favor", () => {
  const r = computeSaleTotals([sale({ quantity: 2, priceCents: 1200, listPriceCents: 1200 })]);
  assert.equal(r.totalCents, 2400);
  assert.equal(r.favorsCents, 0);
});

test("computeSaleTotals: charging below list records a favor", () => {
  // 1 @ $12 (list $12) + 1 @ $10 (list $12) = $22 collected, $2 favor.
  const r = computeSaleTotals([
    sale({ quantity: 1, priceCents: 1200, listPriceCents: 1200 }),
    sale({ quantity: 1, priceCents: 1000, listPriceCents: 1200 }),
  ]);
  assert.equal(r.totalCents, 2200);
  assert.equal(r.favorsCents, 200);
});

test("computeSaleTotals: above-list never makes a negative favor", () => {
  const r = computeSaleTotals([sale({ quantity: 1, priceCents: 1500, listPriceCents: 1200 })]);
  assert.equal(r.totalCents, 1500);
  assert.equal(r.favorsCents, 0);
});

test("actualFavorsCents: sums (list - charged) x qty across sources", () => {
  const listBySlug = new Map([["classic", 1200], ["rye", 1000]]);
  const sources: SoldSource[] = [
    { items: [{ productSlug: "classic", quantity: 1, priceCents: 1000 }] }, // $2 favor
    { items: [{ productSlug: "classic", quantity: 2, priceCents: 1200 }] }, // $0
    { items: [{ productSlug: "rye", quantity: 1, priceCents: 800 }] },      // $2 favor
  ];
  assert.equal(actualFavorsCents(sources, listBySlug), 400);
});

test("actualFavorsCents: skips items with no price or unknown slug", () => {
  const listBySlug = new Map([["classic", 1200]]);
  const sources: SoldSource[] = [
    { items: [{ productSlug: "classic", quantity: 1 }] },            // no priceCents -> skip
    { items: [{ productSlug: "ghost", quantity: 1, priceCents: 1 }] }, // unknown slug -> skip
  ];
  assert.equal(actualFavorsCents(sources, listBySlug), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `./favors.ts` / exports undefined.

- [ ] **Step 3: Implement `src/lib/favors.ts`**

```ts
/**
 * Pure favor/discount math. No I/O — integer cents in, integer cents out.
 *
 * A "favor" is the gap between a loaf's list price and what was actually
 * charged, clamped at zero (charging *above* list is never a negative favor).
 */

export type SaleLineInput = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
  listPriceCents: number;
};

const intNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const centsNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Total collected and favors given for one in-person sale's lines. */
export function computeSaleTotals(items: SaleLineInput[]): {
  totalCents: number;
  favorsCents: number;
} {
  let totalCents = 0;
  let favorsCents = 0;
  for (const it of items) {
    const qty = intNonNeg(it.quantity);
    if (qty === 0) continue;
    const price = centsNonNeg(it.priceCents);
    const list = centsNonNeg(it.listPriceCents);
    totalCents += qty * price;
    favorsCents += qty * Math.max(0, list - price);
  }
  return { totalCents, favorsCents };
}

export type SoldItem = {
  productSlug: string;
  quantity: number;
  priceCents?: number;
};

export type SoldSource = { items: SoldItem[] };

/**
 * Real favors given across a drop's orders/reservations: for every item with a
 * known list price and a recorded charged price, sum max(0, list - charged) x qty.
 * Items missing a price or an unknown slug contribute nothing.
 */
export function actualFavorsCents(
  sources: SoldSource[],
  listPriceBySlug: Map<string, number>,
): number {
  let favors = 0;
  for (const src of sources) {
    for (const it of src.items) {
      if (typeof it.priceCents !== "number") continue;
      const list = listPriceBySlug.get(it.productSlug);
      if (typeof list !== "number") continue;
      const qty = intNonNeg(it.quantity);
      favors += qty * Math.max(0, centsNonNeg(list) - centsNonNeg(it.priceCents));
    }
  }
  return favors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all favors tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/favors.ts src/lib/favors.test.ts
git commit -m "feat(favors): pure sale-total and actual-favors math"
```

---

### Task 2: Expose per-item `priceCents` to order/reservation reads

The calculator's actual-favors metric needs each sold item's charged price. The
confirmed-reservation and live-order GROQ reads currently drop `priceCents` from
items; add it, and carry it through `BakeListItem`.

**Files:**
- Modify: `src/lib/bake-list.ts:3-7` (BakeListItem type)
- Modify: `src/lib/catalog.ts:386-397` (normItems)
- Modify: `src/sanity/lib/queries.ts:178` and `:192` (order + confirmed-reservation item projections)

**Interfaces:**
- Consumes: nothing new.
- Produces: `BakeListItem.priceCents?: number` populated on order & reservation reads.

- [ ] **Step 1: Add optional `priceCents` to `BakeListItem`**

In `src/lib/bake-list.ts`, change the type:

```ts
export type BakeListItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  /** Charged unit price in cents. Present on order/reservation items;
   * absent on member selections (used for favor math, optional everywhere). */
  priceCents?: number;
};
```

- [ ] **Step 2: Parse `priceCents` in `normItems`**

In `src/lib/catalog.ts`, update `normItems` (around line 391):

```ts
    const q = Number(o.quantity);
    const p = Number(o.priceCents);
    return {
      productSlug: typeof o.productSlug === "string" ? o.productSlug : "",
      productName: typeof o.productName === "string" ? o.productName : "",
      quantity: Number.isFinite(q) ? q : 0,
      ...(Number.isFinite(p) ? { priceCents: p } : {}),
    };
```

- [ ] **Step 3: Add `priceCents` to the two GROQ item projections**

In `src/sanity/lib/queries.ts`:

`LIVE_ORDERS_FOR_DROP_QUERY` (line ~178), change:
```
      "items": items[]{ productSlug, productName, quantity }
```
to:
```
      "items": items[]{ productSlug, productName, quantity, priceCents }
```

`CONFIRMED_RESERVATIONS_FOR_DROP_QUERY` (line ~192), make the same change:
```
      "items": items[]{ productSlug, productName, quantity, priceCents }
```

- [ ] **Step 4: Verify nothing broke**

Run: `npm test && npm run typecheck`
Expected: PASS — existing bake-list/order tests still green; types compile.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bake-list.ts src/lib/catalog.ts src/sanity/lib/queries.ts
git commit -m "feat(reads): carry item priceCents through order/reservation reads"
```

---

### Task 3: Reservation schema — `channel` field + optional contact

**Files:**
- Modify: `src/sanity/schemaTypes/reservation.ts`

**Interfaces:**
- Produces: `reservation.channel` ("online" | "in-person"); `customerEmail`/`customerPhone` optional.

- [ ] **Step 1: Relax email/phone validation**

In `src/sanity/schemaTypes/reservation.ts`, change `customerEmail` (keep email format check only when present) and `customerPhone`:

```ts
    defineField({
      name: "customerEmail",
      title: "Customer email",
      type: "string",
      validation: (rule) => rule.email(),
    }),
    defineField({
      name: "customerPhone",
      title: "Customer phone",
      type: "string",
    }),
```

- [ ] **Step 2: Add the `channel` field**

Add after `customerPhone` (before `drop`):

```ts
    defineField({
      name: "channel",
      title: "Channel",
      type: "string",
      options: {
        list: [
          { title: "Online", value: "online" },
          { title: "In-person (hand-logged)", value: "in-person" },
        ],
        layout: "radio",
      },
      initialValue: "online",
    }),
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/reservation.ts
git commit -m "feat(schema): add reservation channel; make contact optional"
```

---

### Task 4: `createInPersonSale` mutation

**Files:**
- Modify: `src/sanity/lib/mutations.ts` (add after `createReservation`, ~line 232)

**Interfaces:**
- Consumes: `decrementDropQuantities(dropId, items)` (existing, same file), `writeClient`.
- Produces:
  ```ts
  createInPersonSale(input: {
    dropId: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
    totalCents: number;
  }): Promise<string | null>
  ```

- [ ] **Step 1: Implement the mutation**

Add to `src/sanity/lib/mutations.ts` (reuses the local `ReservationItemInput` type):

```ts
/**
 * Create a hand-logged in-person sale as an already-confirmed reservation
 * (channel "in-person"). Name required; email/phone optional. Decrements drop
 * stock like a normal confirm. Best-effort decrement: if it throws, the doc is
 * still authoritative — log a greppable signal (mirrors decideReservation).
 */
export async function createInPersonSale(input: {
  dropId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  items: ReservationItemInput[];
  totalCents: number;
}): Promise<string | null> {
  if (!writeClient || !input.dropId) return null;
  const now = new Date().toISOString();
  const email = input.customerEmail?.trim().toLowerCase();
  const doc = await writeClient.create({
    _type: "reservation",
    channel: "in-person",
    customerName: input.customerName,
    ...(email ? { customerEmail: email } : {}),
    ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
    drop: { _type: "reference", _ref: input.dropId },
    items: input.items.map((i) => ({ _type: "reservationItem", ...i })),
    totalCents: input.totalCents,
    status: "confirmed",
    createdAt: now,
    decidedAt: now,
    fulfillmentStatus: "new",
  });
  try {
    await decrementDropQuantities(
      input.dropId,
      input.items.map((i) => ({ slug: i.productSlug, quantity: i.quantity })),
    );
  } catch (err) {
    console.error("[in-person] SALE SAVED BUT STOCK NOT DECREMENTED", doc._id, err);
  }
  return doc._id;
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/sanity/lib/mutations.ts
git commit -m "feat(mutations): createInPersonSale (confirmed in-person reservation)"
```

---

### Task 5: API route `POST /api/admin/reservations/in-person`

**Files:**
- Create: `src/app/api/admin/reservations/in-person/route.ts`

**Interfaces:**
- Consumes: `getAdminSession`, `createInPersonSale`, `computeSaleTotals` (Task 1, for trustworthy server-side total).
- Produces: HTTP endpoint. Body `{ dropId, customerName, customerEmail?, customerPhone?, items: [{ productSlug, productName, quantity, priceCents, listPriceCents }] }`.

- [ ] **Step 1: Implement the route**

```ts
// src/app/api/admin/reservations/in-person/route.ts
import { getAdminSession } from "@/lib/admin-auth";
import { computeSaleTotals, type SaleLineInput } from "@/lib/favors";
import { createInPersonSale } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId.trim() : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  if (!dropId) return Response.json({ error: "Missing drop." }, { status: 400 });
  if (!customerName) return Response.json({ error: "A buyer name is required." }, { status: 400 });

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: SaleLineInput[] = rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        productSlug: typeof o.productSlug === "string" ? o.productSlug : "",
        productName: typeof o.productName === "string" ? o.productName : "",
        quantity: int(o.quantity),
        priceCents: int(o.priceCents),
        listPriceCents: int(o.listPriceCents),
      };
    })
    .filter((i) => i.productSlug && i.quantity > 0);

  if (items.length === 0) {
    return Response.json({ error: "Add at least one loaf with a quantity." }, { status: 400 });
  }

  const { totalCents } = computeSaleTotals(items);

  const id = await createInPersonSale({
    dropId,
    customerName,
    customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
    customerPhone: typeof body.customerPhone === "string" ? body.customerPhone : undefined,
    items: items.map(({ productSlug, productName, quantity, priceCents }) => ({
      productSlug,
      productName,
      quantity,
      priceCents,
    })),
    totalCents,
  });

  if (!id) {
    return Response.json(
      { error: "Saving isn't configured (no Sanity write token)." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, id });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/reservations/in-person/route.ts
git commit -m "feat(api): admin route to log an in-person sale"
```

---

### Task 6: In-person sale form + reservations page wiring

**Files:**
- Create: `src/components/in-person-sale-form.tsx`
- Modify: `src/app/admin/reservations/page.tsx`
- Modify: `src/sanity/lib/queries.ts` (add `channel` to `RESERVATIONS_QUERY`)

**Interfaces:**
- Consumes: `POST /api/admin/reservations/in-person`, `computeSaleTotals`, `formatPrice`.
- Props: `InPersonSaleForm({ drops })` where `drops: { id: string; title: string; lines: { productSlug: string; productName: string; listPriceCents: number }[] }[]`.

- [ ] **Step 1: Add `channel` to `RESERVATIONS_QUERY`**

In `src/sanity/lib/queries.ts`, add `channel` to the projection (line ~159):

```
    "id": _id, customerName, customerEmail, customerPhone, channel,
```

- [ ] **Step 2: Build the form component**

```tsx
// src/components/in-person-sale-form.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { computeSaleTotals, type SaleLineInput } from "@/lib/favors";
import { formatPrice } from "@/lib/money";

type DropLine = { productSlug: string; productName: string; listPriceCents: number };
export type SaleDrop = { id: string; title: string; lines: DropLine[] };

type Row = { quantity: number; priceCents: number };

const dollars = (cents: number) => (cents / 100).toFixed(2);
const toCents = (v: string) => {
  const n = Math.round(Number.parseFloat(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const toQty = (v: string) => {
  const n = Math.floor(Number.parseFloat(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function InPersonSaleForm({ drops }: { drops: SaleDrop[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dropId, setDropId] = useState(drops[0]?.id ?? "");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const drop = drops.find((d) => d.id === dropId) ?? null;

  const saleItems = useMemo<SaleLineInput[]>(() => {
    if (!drop) return [];
    return drop.lines
      .map((l) => {
        const row = rows[l.productSlug];
        const quantity = row?.quantity ?? 0;
        const priceCents = row?.priceCents ?? l.listPriceCents;
        return {
          productSlug: l.productSlug,
          productName: l.productName,
          quantity,
          priceCents,
          listPriceCents: l.listPriceCents,
        };
      })
      .filter((i) => i.quantity > 0);
  }, [drop, rows]);

  const { totalCents, favorsCents } = computeSaleTotals(saleItems);

  function setRow(slug: string, patch: Partial<Row>) {
    setRows((cur) => ({ ...cur, [slug]: { quantity: 0, priceCents: 0, ...cur[slug], ...patch } }));
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/reservations/in-person", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropId, customerName: name, items: saleItems }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      setName("");
      setRows({});
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  if (drops.length === 0) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-acid text-sm">
        ＋ Add in-person sale
      </button>
    );
  }

  return (
    <div className="nb-card mt-4 space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold" htmlFor="ip-drop">Drop</label>
        <select
          id="ip-drop"
          value={dropId}
          onChange={(e) => { setDropId(e.target.value); setRows({}); }}
          className="rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-semibold"
        >
          {drops.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <input
          type="text"
          aria-label="Buyer name"
          placeholder="Buyer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm"
        />
      </div>

      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-ink-500">
          <tr><th className="py-2">Loaf</th><th className="py-2">List</th><th className="py-2">Qty</th><th className="py-2">Price each</th><th className="py-2 text-right">Favor</th></tr>
        </thead>
        <tbody>
          {drop?.lines.map((l) => {
            const row = rows[l.productSlug];
            const qty = row?.quantity ?? 0;
            const price = row?.priceCents ?? l.listPriceCents;
            const favor = qty * Math.max(0, l.listPriceCents - price);
            return (
              <tr key={l.productSlug} className="border-t border-ink/10">
                <td className="py-2 font-semibold">{l.productName}</td>
                <td className="py-2 text-ink-500">{formatPrice(l.listPriceCents)}</td>
                <td className="py-2">
                  <input type="number" min={0} step="1" aria-label={`Quantity of ${l.productName}`}
                    value={qty || ""} onChange={(e) => setRow(l.productSlug, { quantity: toQty(e.target.value) })}
                    className="w-16 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right" />
                </td>
                <td className="py-2">
                  <span className="text-ink-500">$</span>
                  <input type="number" min={0} step="0.01" aria-label={`Price each for ${l.productName}`}
                    value={dollars(price)} onChange={(e) => setRow(l.productSlug, { priceCents: toCents(e.target.value) })}
                    className="ml-1 w-20 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right" />
                </td>
                <td className="py-2 text-right">{favor > 0 ? formatPrice(favor) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Total <strong>{formatPrice(totalCents)}</strong>
          {favorsCents > 0 ? <span className="ml-2 text-flame-700">favors {formatPrice(favorsCents)}</span> : null}
        </p>
        <div className="flex items-center gap-2">
          {msg ? <span className="text-xs text-flame-700">{msg}</span> : null}
          <button type="button" onClick={() => setOpen(false)} className="btn-outline text-sm">Cancel</button>
          <button type="button" disabled={busy || !name || saleItems.length === 0} onClick={submit}
            className="btn-acid text-sm disabled:opacity-60">
            {busy ? "Saving…" : "Save sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the page**

In `src/app/admin/reservations/page.tsx`: add `channel` to the `Row` type, load drops for the form, render the form, and add an "in-person" badge.

Add to imports:
```ts
import { InPersonSaleForm, type SaleDrop } from "@/components/in-person-sale-form";
import { getDropsView } from "@/lib/catalog";
```

Extend the `Row` type:
```ts
  channel?: "online" | "in-person";
```

In the component body, after fetching `rows`, build the drops list:
```ts
  const { current, previous } = await getDropsView({ fresh: true });
  const saleDrops: SaleDrop[] = [current, ...previous]
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({
      id: d.id,
      title: d.title,
      lines: d.lineItems.map((li) => ({
        productSlug: li.product.slug,
        productName: li.product.name,
        listPriceCents: li.product.priceCents,
      })),
    }));
```

Under the `<h1>`, render the form:
```tsx
      <div className="mt-4"><InPersonSaleForm drops={saleDrops} /></div>
```

In the row markup, add a channel badge next to the status badge:
```tsx
                  {r.channel === "in-person" ? (
                    <span className="badge badge-sage">in-person</span>
                  ) : null}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/in-person-sale-form.tsx src/app/admin/reservations/page.tsx src/sanity/lib/queries.ts
git commit -m "feat(admin): in-person sale form on reservations page"
```

---

### Task 7: "Favors given (actual)" on the calculator

**Files:**
- Modify: `src/app/admin/calculator/page.tsx`
- Modify: `src/app/admin/calculator/calculator-client.tsx`

**Interfaces:**
- Consumes: `actualFavorsCents` (Task 1), `orders`/`reservations` already loaded by the page (now carrying `priceCents` per item, Task 2).
- Produces: new `actualFavorsCents` prop on `CalculatorProps`, rendered as a metric.

- [ ] **Step 1: Compute actual favors in the page**

In `src/app/admin/calculator/page.tsx`, add the import:
```ts
import { actualFavorsCents } from "@/lib/favors";
```

After `seedLines` is built, compute the list-price map and favors:
```ts
  const listBySlug = new Map(
    drop.lineItems.map((li) => [li.product.slug, li.product.priceCents] as const),
  );
  const favorsActualCents = actualFavorsCents([...orders, ...reservations], listBySlug);
```

Pass it into the component:
```tsx
          actualCollectedCents={actualCollectedCents}
          actualFavorsCents={favorsActualCents}
          savedFixedCosts={saved?.fixedCosts ?? null}
```

- [ ] **Step 2: Render the metric in the client**

In `src/app/admin/calculator/calculator-client.tsx`, add to `CalculatorProps`:
```ts
  actualFavorsCents: number;
```

Destructure it in the component signature alongside `actualCollectedCents`, then add a metric card in the existing `grid gap-4 sm:grid-cols-3` block (after the "Favors / discounts given" modeled metric):
```tsx
        <Metric
          label="Favors given (actual)"
          value={formatPrice(actualFavorsCents)}
          hint="Real discounts handed out — from the per-loaf prices on actual orders & in-person sales."
          small
        />
```

Change that grid wrapper from `sm:grid-cols-3` to `sm:grid-cols-4` so all four cards fit.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/calculator/page.tsx src/app/admin/calculator/calculator-client.tsx
git commit -m "feat(calculator): show actual favors given from real per-item prices"
```

---

## Self-Review

**Spec coverage:**
- Data model (channel + optional contact) → Task 3. ✓
- Per-item price availability for favor math → Task 2. ✓
- `createInPersonSale` + stock decrement → Task 4. ✓
- Admin API route → Task 5. ✓
- Form on reservations page + in-person badge → Task 6. ✓
- "Favors given (actual)" calculator metric → Task 7. ✓
- Pure math + tests → Task 1. ✓
- Reuse of bake list / "actually collected" → free via confirmed reservation (no task needed; verified in design). ✓

**Placeholder scan:** None — every step has concrete code/commands.

**Type consistency:** `SaleLineInput`, `SoldSource`, `computeSaleTotals`, `actualFavorsCents` defined in Task 1 and used identically in Tasks 5–7. `createInPersonSale` signature defined in Task 4 matches its call in Task 5. `SaleDrop` defined in Task 6 and used in Task 6 page wiring.

**Notes:** Mutations and API routes have no unit tests, consistent with the existing codebase (only pure `src/lib` modules are unit-tested). They are covered by `typecheck`/`lint` and manual verification.
