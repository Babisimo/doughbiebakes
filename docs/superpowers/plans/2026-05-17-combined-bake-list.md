# Combined Bake List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/club/[dropId]` show one combined per-drop bake tally plus three roster sections — Bread Club members, live public orders, and confirmed reservations.

**Architecture:** A pure `src/lib/bake-list.ts` (`buildBakeListView`) merges three already-fetched source arrays into a combined tally + typed roster rows; it is unit-tested with `node:test` and has zero imports / no `server-only`. Two new GROQ queries + three `catalog.ts` wrappers do the I/O (live-orders-for-drop, confirmed-reservations-for-drop, pending-reservation-count); the page stays the thin server component that fetches, runs the existing per-member Stripe enrichment, and renders.

**Tech Stack:** Next.js 16 App Router, TypeScript, Sanity (GROQ), Tailwind v4, `node:test` (`node --test --experimental-strip-types`).

**Spec:** `docs/superpowers/specs/2026-05-17-combined-bake-list-design.md`

---

## File Structure

- **Create** `src/lib/bake-list.ts` — pure aggregator. Owns all `BakeList*` / `*Source` types and `buildBakeListView`. Zero imports, no `server-only` (must stay `node:test`-reachable, like `order-record.ts`).
- **Create** `src/lib/__tests__/bake-list.test.ts` — 7 `node:test` cases for `buildBakeListView`.
- **Modify** `src/sanity/lib/queries.ts` — append 3 GROQ query constants.
- **Modify** `src/lib/catalog.ts` — add 3 fetch wrappers (`type`-only import from `./bake-list`).
- **Modify** `src/app/admin/club/[dropId]/page.tsx` — full rewrite of the body: combined Bake-totals card + Members (unchanged table) + Public orders + Confirmed reservations; remove the old member-only "Tally per flavor" section.

Baseline: `npm test` currently reports **34 pass / 0 fail**. After Task 1 it must report **41 pass / 0 fail**.

---

### Task 1: Pure `buildBakeListView` aggregator (TDD)

**Files:**
- Create: `src/lib/bake-list.ts`
- Test: `src/lib/__tests__/bake-list.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/bake-list.test.ts` with exactly this content:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBakeListView } from "../bake-list.ts";

const drop = {
  lineItems: [
    { product: { slug: "classic", name: "Classic Sourdough" } },
    { product: { slug: "jalapeno", name: "Jalapeño Cheddar" } },
    { product: { slug: "rosemary", name: "Rosemary" } },
  ],
};

function base(over: Partial<Parameters<typeof buildBakeListView>[0]> = {}) {
  return {
    drop,
    members: [],
    orders: [],
    reservations: [],
    pendingReservationCount: 0,
    ...over,
  };
}

test("combines tally across members + orders + confirmed reservations", () => {
  const v = buildBakeListView(
    base({
      members: [
        { customerEmail: "a@x.com", productSlug: "classic", source: "explicit", fulfillment: "pickup" },
        { customerEmail: "b@x.com", productSlug: "classic", source: "explicit", fulfillment: "ship" },
      ],
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [{ productSlug: "classic", productName: "Classic Sourdough", quantity: 3 }],
          fulfillment: "ship",
          shipAddress: null,
          totalCents: 3300,
        },
      ],
      reservations: [
        {
          customerEmail: "d@x.com",
          customerName: "Dee",
          customerPhone: "556",
          items: [{ productSlug: "jalapeno", productName: "Jalapeño Cheddar", quantity: 2 }],
          totalCents: 2400,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic")?.count, 5);
  assert.equal(v.totals.find((t) => t.slug === "jalapeno")?.count, 2);
  assert.equal(v.counts.loaves, 7);
  assert.equal(v.counts.members, 2);
  assert.equal(v.counts.orders, 1);
  assert.equal(v.counts.reservations, 1);
});

test("tally sums quantities, not row counts", () => {
  const v = buildBakeListView(
    base({
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: null,
          customerPhone: null,
          items: [{ productSlug: "rosemary", productName: "Rosemary", quantity: 4 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 4400,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "rosemary")?.count, 4);
});

test("synthetic default member picks count toward the tally", () => {
  const v = buildBakeListView(
    base({
      members: [{ customerEmail: "z@x.com", productSlug: "classic", source: "default" }],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic")?.count, 1);
  assert.equal(v.members[0].source, "default");
  assert.equal(v.members[0].fulfillment, "pickup");
});

test("slug not in drop → inDrop:false, name from productName, ordered after drop items", () => {
  const v = buildBakeListView(
    base({
      members: [{ customerEmail: "a@x.com", productSlug: "classic", source: "explicit" }],
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [{ productSlug: "ghost", productName: "Ghost Loaf", quantity: 1 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 1000,
        },
      ],
    }),
  );
  const ghost = v.totals.find((t) => t.slug === "ghost");
  assert.equal(ghost?.inDrop, false);
  assert.equal(ghost?.name, "Ghost Loaf");
  assert.equal(v.totals[0].slug, "classic");
  assert.equal(v.totals[v.totals.length - 1].slug, "ghost");
});

test("qty <= 0 and non-integer are floored/dropped (tally and row)", () => {
  const v = buildBakeListView(
    base({
      orders: [
        {
          customerEmail: "c@x.com",
          customerName: "Cee",
          customerPhone: "555",
          items: [
            { productSlug: "classic", productName: "Classic Sourdough", quantity: 0 },
            { productSlug: "rosemary", productName: "Rosemary", quantity: 2.5 },
          ],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 0,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic"), undefined);
  assert.equal(v.totals.find((t) => t.slug === "rosemary")?.count, 2);
  assert.deepEqual(v.orders[0].items.map((i) => i.slug), ["rosemary"]);
});

test("empty sources → empty totals, zeroed counts, pending passthrough", () => {
  const v = buildBakeListView(base({ pendingReservationCount: 3 }));
  assert.deepEqual(v.totals, []);
  assert.equal(v.counts.loaves, 0);
  assert.equal(v.counts.members, 0);
  assert.equal(v.counts.orders, 0);
  assert.equal(v.counts.reservations, 0);
  assert.equal(v.pendingReservationCount, 3);
});

test("no dedup across sources — same email as member and order both count", () => {
  const v = buildBakeListView(
    base({
      members: [{ customerEmail: "same@x.com", productSlug: "classic", source: "explicit" }],
      orders: [
        {
          customerEmail: "same@x.com",
          customerName: "Same",
          customerPhone: "555",
          items: [{ productSlug: "classic", productName: "Classic Sourdough", quantity: 2 }],
          fulfillment: "pickup",
          shipAddress: null,
          totalCents: 2200,
        },
      ],
    }),
  );
  assert.equal(v.totals.find((t) => t.slug === "classic")?.count, 3);
  assert.equal(v.members.length, 1);
  assert.equal(v.orders.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/__tests__/bake-list.test.ts`
Expected: FAIL — cannot find module `../bake-list.ts` / `buildBakeListView is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bake-list.ts` with exactly this content (zero imports, no `server-only` — keeps it `node:test`-reachable like `order-record.ts`):

```ts
export type BakeListItem = {
  productSlug: string;
  productName: string;
  quantity: number;
};

export type BakeOrderShipAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

/** A member's pick. `fulfillment`/`source` are optional because the
 * `memberSelection` doc/type leaves them optional; we coalesce. */
export type MemberSource = {
  customerEmail: string;
  productSlug: string;
  fulfillment?: "pickup" | "ship";
  source?: "explicit" | "default";
};

export type OrderSource = {
  customerEmail: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: BakeListItem[];
  fulfillment: "pickup" | "ship";
  shipAddress?: BakeOrderShipAddress | null;
  totalCents: number;
};

export type ReservationSource = {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  items: BakeListItem[];
  totalCents: number;
};

export type DropForBake = {
  lineItems: { product: { slug: string; name: string } }[];
};

export type BakeListInput = {
  drop: DropForBake;
  members: MemberSource[];
  orders: OrderSource[];
  reservations: ReservationSource[];
  pendingReservationCount: number;
};

export type BakeTotal = {
  slug: string;
  name: string;
  count: number;
  inDrop: boolean;
};

export type BakeMemberRow = {
  email: string;
  slug: string;
  productName: string;
  source: "explicit" | "default";
  fulfillment: "pickup" | "ship";
};

export type BakeOrderRow = {
  email: string;
  name: string | null;
  phone: string | null;
  items: { slug: string; name: string; qty: number }[];
  fulfillment: "pickup" | "ship";
  shipAddress: BakeOrderShipAddress | null;
  totalCents: number;
};

export type BakeReservationRow = {
  email: string;
  name: string;
  phone: string;
  items: { slug: string; name: string; qty: number }[];
  totalCents: number;
};

export type BakeListView = {
  totals: BakeTotal[];
  members: BakeMemberRow[];
  orders: BakeOrderRow[];
  reservations: BakeReservationRow[];
  pendingReservationCount: number;
  counts: { members: number; orders: number; reservations: number; loaves: number };
};

/**
 * Merge Bread Club member picks, live public orders, and confirmed
 * reservations into one per-drop bake tally plus per-source roster rows.
 * Pure: no I/O. The member person-name/contact is layered on by the page
 * (Stripe lookup) after this returns — this only carries the chosen flavor.
 */
export function buildBakeListView(input: BakeListInput): BakeListView {
  const { drop, members, orders, reservations, pendingReservationCount } = input;

  const dropNameBySlug = new Map<string, string>();
  const dropOrder = new Map<string, number>();
  drop.lineItems.forEach((li, i) => {
    if (!dropNameBySlug.has(li.product.slug)) {
      dropNameBySlug.set(li.product.slug, li.product.name);
      dropOrder.set(li.product.slug, i);
    }
  });

  const tally = new Map<string, BakeTotal>();

  const norm = (q: number) => {
    const n = Math.floor(Number.isFinite(q) ? q : 0);
    return n >= 1 ? n : 0;
  };

  const add = (slug: string, qty: number, fallbackName: string) => {
    const n = norm(qty);
    if (n === 0) return;
    const cur = tally.get(slug);
    if (cur) {
      cur.count += n;
      return;
    }
    tally.set(slug, {
      slug,
      name: dropNameBySlug.get(slug) ?? fallbackName ?? slug,
      count: n,
      inDrop: dropNameBySlug.has(slug),
    });
  };

  const memberRows: BakeMemberRow[] = members.map((m) => {
    add(m.productSlug, 1, m.productSlug);
    return {
      email: m.customerEmail,
      slug: m.productSlug,
      productName: dropNameBySlug.get(m.productSlug) ?? m.productSlug,
      source: m.source ?? "explicit",
      fulfillment: m.fulfillment ?? "pickup",
    };
  });

  const mapItems = (items: BakeListItem[]) =>
    items
      .map((it) => ({
        slug: it.productSlug,
        name: dropNameBySlug.get(it.productSlug) ?? it.productName ?? it.productSlug,
        qty: norm(it.quantity),
      }))
      .filter((it) => it.qty >= 1);

  const orderRows: BakeOrderRow[] = orders.map((o) => {
    for (const it of o.items) add(it.productSlug, it.quantity, it.productName);
    return {
      email: o.customerEmail,
      name: o.customerName ?? null,
      phone: o.customerPhone ?? null,
      items: mapItems(o.items),
      fulfillment: o.fulfillment,
      shipAddress: o.shipAddress ?? null,
      totalCents: o.totalCents,
    };
  });

  const reservationRows: BakeReservationRow[] = reservations.map((r) => {
    for (const it of r.items) add(it.productSlug, it.quantity, it.productName);
    return {
      email: r.customerEmail,
      name: r.customerName,
      phone: r.customerPhone,
      items: mapItems(r.items),
      totalCents: r.totalCents,
    };
  });

  const all = [...tally.values()];
  const totals: BakeTotal[] = [
    ...all
      .filter((t) => t.inDrop)
      .sort((a, b) => (dropOrder.get(a.slug) ?? 0) - (dropOrder.get(b.slug) ?? 0)),
    ...all.filter((t) => !t.inDrop),
  ];

  return {
    totals,
    members: memberRows,
    orders: orderRows,
    reservations: reservationRows,
    pendingReservationCount,
    counts: {
      members: memberRows.length,
      orders: orderRows.length,
      reservations: reservationRows.length,
      loaves: totals.reduce((s, t) => s + t.count, 0),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/__tests__/bake-list.test.ts`
Expected: PASS — `tests 7 ... pass 7 ... fail 0`.

- [ ] **Step 5: Run the full suite + typecheck + lint**

Run: `npm test`
Expected: `tests 41 ... pass 41 ... fail 0`.

Run: `npm run typecheck`
Expected: exit 0, no output.

Run: `npm run lint`
Expected: exit 0 (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bake-list.ts src/lib/__tests__/bake-list.test.ts
git commit -m "feat: pure buildBakeListView aggregator (tested)"
```

---

### Task 2: GROQ queries + catalog fetch wrappers

**Files:**
- Modify: `src/sanity/lib/queries.ts` (append at end of file)
- Modify: `src/lib/catalog.ts` (add import + 3 functions)

- [ ] **Step 1: Append the three GROQ queries**

At the end of `src/sanity/lib/queries.ts`, append:

```ts
// Live (real-money) public orders for one drop, oldest first. Test-mode
// orders (livemode == false) are intentionally excluded from the bake list.
export const LIVE_ORDERS_FOR_DROP_QUERY = groq`
  *[_type == "order" && drop._ref == $dropId && livemode == true]
    | order(createdAt asc){
      "customerEmail": customerEmail,
      "customerName": customerName,
      "customerPhone": customerPhone,
      fulfillment,
      "shipAddress": shipAddress{ line1, line2, city, state, postalCode },
      totalCents,
      "items": items[]{ productSlug, productName, quantity }
    }`;

// Confirmed reservations for one drop, oldest first. Pending/declined are
// excluded from the bake tally (pending is surfaced as a separate count).
export const CONFIRMED_RESERVATIONS_FOR_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId && status == "confirmed"]
    | order(createdAt asc){
      "customerEmail": customerEmail,
      "customerName": customerName,
      "customerPhone": customerPhone,
      totalCents,
      "items": items[]{ productSlug, productName, quantity }
    }`;

// Heads-up count only — pending reservations the baker hasn't decided yet.
export const PENDING_RESERVATION_COUNT_FOR_DROP_QUERY = groq`
  count(*[_type == "reservation" && drop._ref == $dropId && status == "pending"])`;
```

- [ ] **Step 2: Add the catalog wrappers**

In `src/lib/catalog.ts`, add the new query names to the existing import block from `@/sanity/lib/queries` (the block that currently imports `ACTIVE_MEMBER_COUNT_QUERY` … `RECENT_DROPS_QUERY`):

```ts
  ACTIVE_MEMBER_COUNT_QUERY,
  ACTIVE_MEMBERS_QUERY,
  ALL_PRODUCTS_QUERY,
  CONFIRMED_RESERVATIONS_FOR_DROP_QUERY,
  LIVE_ORDERS_FOR_DROP_QUERY,
  MEMBER_BY_EMAIL_QUERY,
  MEMBER_SELECTIONS_FOR_DROP_QUERY,
  PENDING_RESERVATION_COUNT_FOR_DROP_QUERY,
  PRODUCT_BY_SLUG_QUERY,
  PRODUCTS_BY_SLUGS_QUERY,
  RECENT_DROPS_QUERY,
```

Add a `type`-only import near the other local imports (e.g., directly under `import type { MemberSelection } from "./availability";`):

```ts
import type { OrderSource, ReservationSource } from "./bake-list";
```

Append these three functions at the end of `src/lib/catalog.ts`:

```ts
/**
 * Live (real-money) public orders for a drop, oldest first. `[]` in demo
 * mode or if the query throws (degrade-to-empty so the bake list still
 * renders members/reservations).
 */
export async function getLiveOrdersForDrop(
  dropId: string,
  opts: FetchOpts = {},
): Promise<OrderSource[]> {
  if (!sanityClient || !dropId) return [];
  try {
    const rows = await fetchSanity<OrderSource[]>(
      LIVE_ORDERS_FOR_DROP_QUERY,
      { dropId },
      opts,
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("[admin/club] orders fetch failed", err);
    return [];
  }
}

/**
 * Confirmed reservations for a drop, oldest first. `[]` in demo mode or on
 * query failure.
 */
export async function getConfirmedReservationsForDrop(
  dropId: string,
  opts: FetchOpts = {},
): Promise<ReservationSource[]> {
  if (!sanityClient || !dropId) return [];
  try {
    const rows = await fetchSanity<ReservationSource[]>(
      CONFIRMED_RESERVATIONS_FOR_DROP_QUERY,
      { dropId },
      opts,
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("[admin/club] reservations fetch failed", err);
    return [];
  }
}

/** Count of still-pending reservations for a drop. `0` in demo mode or on
 * failure (a heads-up number — under-reporting is acceptable). */
export async function getPendingReservationCountForDrop(
  dropId: string,
  opts: FetchOpts = {},
): Promise<number> {
  if (!sanityClient || !dropId) return 0;
  try {
    const n = await fetchSanity<number>(
      PENDING_RESERVATION_COUNT_FOR_DROP_QUERY,
      { dropId },
      opts,
    );
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error("[admin/club] pending reservation count failed", err);
    return 0;
  }
}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck`
Expected: exit 0, no output.

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds (no type/route errors).

- [ ] **Step 4: Commit**

```bash
git add src/sanity/lib/queries.ts src/lib/catalog.ts
git commit -m "feat: catalog wrappers for live orders + confirmed reservations + pending count"
```

---

### Task 3: Wire the combined bake list into the admin page

**Files:**
- Modify: `src/app/admin/club/[dropId]/page.tsx` (full body rewrite)

- [ ] **Step 1: Replace the entire file contents**

Read `src/app/admin/club/[dropId]/page.tsx` first (Edit/Write requires it), then overwrite the whole file with exactly this content:

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
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";

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
          Everything for this drop: {view.counts.members} member ·{" "}
          {view.counts.orders} public order
          {view.counts.orders === 1 ? "" : "s"} · {view.counts.reservations}{" "}
          confirmed reservation
          {view.counts.reservations === 1 ? "" : "s"}.
        </p>
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
                </tr>
              </thead>
              <tbody>
                {view.orders.map((o, i) => (
                  <tr
                    key={`${o.email}-${i}`}
                    className="border-b border-ink/10 align-top last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{o.name ?? "(no name)"}</div>
                      <div className="text-ink-700">{o.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{itemsLabel(o.items)}</div>
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
                    <td className="px-4 py-3 text-ink-700">{o.phone ?? "—"}</td>
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
                  </tr>
                ))}
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
                </tr>
              </thead>
              <tbody>
                {view.reservations.map((r, i) => (
                  <tr
                    key={`${r.email}-${i}`}
                    className="border-b border-ink/10 align-top last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-ink-700">{r.email}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {itemsLabel(r.items)}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{r.phone}</td>
                    <td className="px-4 py-3 text-ink-700">
                      {formatPrice(r.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck`
Expected: exit 0, no output. (Verifies `Drop`→`DropForBake` and `MemberSelection[]`→`MemberSource[]` are structurally compatible, and `getStripe`/`formatPrice`/`site` still resolve.)

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds; the `/admin/club/[dropId]` route compiles.

- [ ] **Step 3: Run the full test suite (no regression)**

Run: `npm test`
Expected: `tests 41 ... pass 41 ... fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/club/[dropId]/page.tsx
git commit -m "feat: combined bake list — members + live orders + confirmed reservations"
```

- [ ] **Step 5: Manual verification note (for the human/reviewer)**

This page needs a logged-in admin session and live Sanity data — it cannot be unit-tested. After deploy, verify at `/admin/club/<active-drop-id>`: the Bake-totals card sums members + live orders + confirmed reservations; test-mode orders do **not** appear; the pending-reservation note shows when applicable; the Members table is unchanged. State explicitly that this is a manual check.

---

## Self-Review

**1. Spec coverage:**
- Pure `bake-list.ts` + `node:test` (7 cases) → Task 1. ✓
- Live-orders-only / confirmed-only / pending-count filtering → encoded in the Task 2 GROQ (`livemode == true`, `status == "confirmed"`, pending `count()`). ✓
- 2 new queries + catalog wrappers, demo-mode `[]`/`0`, degrade-to-empty → Task 2. ✓ (spec says "two new GROQ queries"; this plan adds the pending-count query as a third — the spec body itself lists all three in its architecture, so this is consistent, not scope creep.)
- Combined Bake-totals card + Members (unchanged) + Public orders + Confirmed reservations w/ pending note; old member-only "Tally per flavor" removed → Task 3. ✓
- `BakeMemberRow.productName` (member person-name stays in the page's Stripe layer) → matches spec's corrected contract. ✓
- Slug/qty hardening, no cross-source dedup, slug-not-in-drop ordering → covered by `add`/`norm`/`totals` ordering and tests 4/5/7. ✓
- Out-of-scope (orphan `drop==null` orders, previous-drop lists, write paths) → untouched. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step has full literal content.

**3. Type consistency:** `buildBakeListView` signature is identical across Task 1 (impl), the test file, the `OrderSource`/`ReservationSource` `type` import in Task 2 catalog, and the Task 3 page call site. Query projections (`customerEmail`, `customerName`, `customerPhone`, `fulfillment`, `shipAddress{line1,line2,city,state,postalCode}`, `totalCents`, `items[]{productSlug,productName,quantity}`) match `OrderSource`/`ReservationSource`/`BakeListItem` field-for-field. `MemberSource.fulfillment`/`source` optional matches the real `MemberSelection` type (catalog passes `selections` straight through). No mismatches found.
