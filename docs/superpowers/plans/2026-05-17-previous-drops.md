# Auto open/close drops + "Previous drops" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive drop open/closed state from `ordersOpenAt`/`ordersCloseAt` at read time (no cron), and add a home-page "Previous drops" section showing the 2 most recently-ended drops.

**Architecture:** A pure `effectiveDropStatus(drop, now)` helper is the single source of truth. The Sanity query returns a bounded recent-drops list; `catalog.ts` splits it into the effective-current drop and previous drops. Everything that gated on `drop.status` now calls the helper. `getActiveDrop()`'s signature is unchanged so its 9 callers keep working and gain correctness for free; only the home page additionally uses the new `getDropsView()` to also get previous drops.

**Tech Stack:** Next.js 16 (App Router, RSC, TypeScript), Tailwind v4, Sanity (GROQ), Node's built-in `node:test` (requires Node ≥ 22.6 for native TypeScript test execution — already implied by Next 16's modern-Node requirement).

**Spec:** `docs/superpowers/specs/2026-05-17-previous-drops-design.md`

---

### Task 1: Add `createdAt` to the Drop type + test script

**Files:**
- Modify: `src/lib/types.ts:31-41`
- Modify: `package.json:5-14`

- [ ] **Step 1: Add `createdAt` to the `Drop` type**

In `src/lib/types.ts`, the `Drop` type currently is:

```ts
export type Drop = {
  id: string;
  slug: string;
  title: string;
  status: DropStatus;
  ordersOpenAt?: string;
  ordersCloseAt?: string;
  pickupOrShipDate?: string;
  note?: string;
  lineItems: DropLineItem[];
};
```

Add `createdAt?: string;` after `pickupOrShipDate?: string;`:

```ts
export type Drop = {
  id: string;
  slug: string;
  title: string;
  status: DropStatus;
  ordersOpenAt?: string;
  ordersCloseAt?: string;
  pickupOrShipDate?: string;
  /** Sanity `_createdAt` — final fallback for recency sorting. */
  createdAt?: string;
  note?: string;
  lineItems: DropLineItem[];
};
```

- [ ] **Step 2: Add the `test` script**

In `package.json`, the `scripts` block currently ends with:

```json
    "club:link": "node --env-file=.env.local scripts/club-link.mjs"
```

Add a `test` script (note the trailing comma on the previous line):

```json
    "club:link": "node --env-file=.env.local scripts/club-link.mjs",
    "test": "node --test --experimental-strip-types"
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: exits 0, no output beyond the script banner.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts package.json
git commit -m "feat: add Drop.createdAt + node:test script"
```

---

### Task 2: `effectiveDropStatus` pure helper (TDD)

**Files:**
- Create: `src/lib/__tests__/drop-status.test.ts`
- Create: `src/lib/drop-status.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/drop-status.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dropRecencyKey,
  effectiveDropStatus,
  isCurrentDrop,
  isPreviousDrop,
} from "../drop-status.ts";
import type { Drop } from "../types.ts";

const NOW = new Date("2026-05-17T12:00:00.000Z");
const PAST = "2026-05-10T12:00:00.000Z";
const FUTURE = "2026-05-24T12:00:00.000Z";

function drop(over: Partial<Drop>): Drop {
  return {
    id: "d1",
    slug: "d1",
    title: "Test Drop",
    status: "open",
    lineItems: [],
    ...over,
  };
}

test("draft stays draft regardless of dates", () => {
  assert.equal(
    effectiveDropStatus(drop({ status: "draft", ordersOpenAt: PAST }), NOW),
    "draft",
  );
});

test("manual closed stays closed", () => {
  assert.equal(
    effectiveDropStatus(drop({ status: "closed", ordersCloseAt: FUTURE }), NOW),
    "closed",
  );
});

test("no dates => behaves exactly as stored status", () => {
  for (const s of ["announced", "open", "soldout"] as const) {
    assert.equal(effectiveDropStatus(drop({ status: s }), NOW), s);
  }
});

test("announced auto-opens once ordersOpenAt has passed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "announced", ordersOpenAt: PAST, ordersCloseAt: FUTURE }),
      NOW,
    ),
    "open",
  );
});

test("announced stays announced before ordersOpenAt", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "announced", ordersOpenAt: FUTURE }),
      NOW,
    ),
    "announced",
  );
});

test("open auto-closes once ordersCloseAt has passed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "open", ordersOpenAt: PAST, ordersCloseAt: PAST }),
      NOW,
    ),
    "closed",
  );
});

test("open before its ordersOpenAt is treated as announced", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "open", ordersOpenAt: FUTURE, ordersCloseAt: FUTURE }),
      NOW,
    ),
    "announced",
  );
});

test("soldout stays soldout until close, then closed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "soldout", ordersCloseAt: FUTURE }),
      NOW,
    ),
    "soldout",
  );
  assert.equal(
    effectiveDropStatus(
      drop({ status: "soldout", ordersCloseAt: PAST }),
      NOW,
    ),
    "closed",
  );
});

test("announced past close (never opened) is closed", () => {
  assert.equal(
    effectiveDropStatus(
      drop({ status: "announced", ordersOpenAt: PAST, ordersCloseAt: PAST }),
      NOW,
    ),
    "closed",
  );
});

test("predicates partition current vs previous", () => {
  const live = drop({ status: "open", ordersCloseAt: FUTURE });
  const ended = drop({ status: "open", ordersCloseAt: PAST });
  assert.equal(isCurrentDrop(live, NOW), true);
  assert.equal(isPreviousDrop(live, NOW), false);
  assert.equal(isCurrentDrop(ended, NOW), false);
  assert.equal(isPreviousDrop(ended, NOW), true);
});

test("dropRecencyKey prefers close, then pickup, then createdAt", () => {
  assert.equal(
    dropRecencyKey(drop({ ordersCloseAt: PAST, pickupOrShipDate: FUTURE })),
    new Date(PAST).getTime(),
  );
  assert.equal(
    dropRecencyKey(drop({ pickupOrShipDate: FUTURE })),
    new Date(FUTURE).getTime(),
  );
  assert.equal(
    dropRecencyKey(drop({ createdAt: PAST })),
    new Date(PAST).getTime(),
  );
  assert.equal(dropRecencyKey(drop({})), 0);
});
```

> **Node 24 / native ESM note:** `node --test --experimental-strip-types` runs
> the `.ts` test through Node's native resolver, which requires **explicit
> file extensions** on relative imports (hence `../drop-status.ts` /
> `../types.ts` above). This in turn requires `"allowImportingTsExtensions":
> true` in `tsconfig.json` so `tsc --noEmit` still passes. Add that compiler
> option (alongside the existing options) as part of this task and stage
> `tsconfig.json` with the commit.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../drop-status.ts` (file does not exist yet).

- [ ] **Step 3: Implement `src/lib/drop-status.ts`**

Create `src/lib/drop-status.ts`:

```ts
import type { Drop, DropStatus } from "./types";

/**
 * Effective, time-adjusted drop status. The stored `status` field is the
 * baker's intent; the optional `ordersOpenAt` / `ordersCloseAt` datetimes
 * automate the open/close transitions at read time. A drop with no dates
 * behaves exactly as its stored status (fully manual) — dates are opt-in.
 * All comparisons are UTC milliseconds, so server timezone is irrelevant.
 */
export function effectiveDropStatus(drop: Drop, now: Date): DropStatus {
  const nowMs = now.getTime();
  const openMs = drop.ordersOpenAt ? new Date(drop.ordersOpenAt).getTime() : null;
  const closeMs = drop.ordersCloseAt
    ? new Date(drop.ordersCloseAt).getTime()
    : null;
  const past = (ms: number | null) =>
    ms !== null && Number.isFinite(ms) && nowMs >= ms;
  const before = (ms: number | null) =>
    ms !== null && Number.isFinite(ms) && nowMs < ms;

  switch (drop.status) {
    case "draft":
      return "draft";
    case "closed":
      return "closed";
    case "soldout":
      return past(closeMs) ? "closed" : "soldout";
    case "open":
      if (past(closeMs)) return "closed";
      if (before(openMs)) return "announced";
      return "open";
    case "announced":
      if (past(closeMs)) return "closed";
      if (past(openMs)) return "open";
      return "announced";
    default:
      return drop.status;
  }
}

/** A drop customers can see/buy now (announced, open, or sold out). */
export function isCurrentDrop(drop: Drop, now: Date): boolean {
  const eff = effectiveDropStatus(drop, now);
  return eff === "announced" || eff === "open" || eff === "soldout";
}

/** A drop whose window is over — belongs in "Previous drops". */
export function isPreviousDrop(drop: Drop, now: Date): boolean {
  return effectiveDropStatus(drop, now) === "closed";
}

/**
 * Sort key (ms) for "most recent": close date, else pickup date, else
 * created-at. Drops with none of these sort last (0).
 */
export function dropRecencyKey(drop: Drop): number {
  const src = drop.ordersCloseAt ?? drop.pickupOrShipDate ?? drop.createdAt;
  const ms = src ? new Date(src).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green (`# pass <n>`, `# fail 0`).

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/drop-status.ts src/lib/__tests__/drop-status.test.ts tsconfig.json
git commit -m "feat: add effectiveDropStatus + recency helpers (tested)"
```

---

### Task 3: Seed previous drops (demo / zero-config path)

**Files:**
- Modify: `src/lib/seed-products.ts:106-127`

- [ ] **Step 1: Add `seedPreviousDrops` after `seedDrop`**

In `src/lib/seed-products.ts`, the file ends with the `seedDrop()` function (lines 106-127). Append this new export at the end of the file:

```ts

/**
 * Two already-ended demo drops so the "Previous drops" section is populated
 * before the CMS is wired (mirrors the seedDrop() philosophy of showcasing
 * every state with zero config).
 */
export function seedPreviousDrops(): Drop[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const mk = (
    idx: number,
    title: string,
    slug: string,
    closedDaysAgo: number,
    slugs: string[],
  ): Drop => ({
    id: `seed-prev-${idx}`,
    slug,
    title,
    status: "closed",
    ordersOpenAt: new Date(now - (closedDaysAgo + 5) * day).toISOString(),
    ordersCloseAt: new Date(now - closedDaysAgo * day).toISOString(),
    pickupOrShipDate: new Date(now - (closedDaysAgo - 2) * day).toISOString(),
    createdAt: new Date(now - (closedDaysAgo + 6) * day).toISOString(),
    lineItems: seedProducts
      .filter((p) => slugs.includes(p.slug))
      .map((product) => ({ product, quantity: 0 })),
  });
  return [
    mk(1, "Last Weekend's Drop", "last-weekend", 7, [
      "classic",
      "cheddar-jalapeno",
      "strawberry",
    ]),
    mk(2, "Two Weekends Ago", "two-weekends-ago", 14, [
      "classic",
      "pepperoni-garlic",
      "banana-brown-sugar-cinnamon",
    ]),
  ];
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: exits 0 (the function is exported but not yet used — fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/seed-products.ts
git commit -m "feat: add seedPreviousDrops demo data"
```

---

### Task 4: Sanity query + catalog split

**Files:**
- Modify: `src/sanity/lib/queries.ts:29-47`
- Modify: `src/lib/catalog.ts` (imports 4-18; `getActiveDrop` 103-123; `getMemberSelectionsForDrop` 149-154)

- [ ] **Step 1: Confirm `ACTIVE_DROP_QUERY` has a single importer**

Run: `git grep -n "ACTIVE_DROP_QUERY" -- src`
Expected: matches only in `src/sanity/lib/queries.ts` (definition) and `src/lib/catalog.ts` (import + use). If any other file imports it, stop and reconcile before continuing.

- [ ] **Step 2: Add `createdAt` to `DROP_FIELDS` and replace the query**

In `src/sanity/lib/queries.ts`, `DROP_FIELDS` currently is:

```ts
const DROP_FIELDS = groq`
  "id": _id,
  "slug": slug.current,
  title,
  status,
  ordersOpenAt,
  ordersCloseAt,
  pickupOrShipDate,
  note,
  "lineItems": lineItems[]{
    quantity,
    "product": product->{ ${PRODUCT_FIELDS} }
  }
`;
```

Add `"createdAt": _createdAt,` after `pickupOrShipDate,`:

```ts
const DROP_FIELDS = groq`
  "id": _id,
  "slug": slug.current,
  title,
  status,
  ordersOpenAt,
  ordersCloseAt,
  pickupOrShipDate,
  "createdAt": _createdAt,
  note,
  "lineItems": lineItems[]{
    quantity,
    "product": product->{ ${PRODUCT_FIELDS} }
  }
`;
```

Then replace the `ACTIVE_DROP_QUERY` export:

```ts
export const ACTIVE_DROP_QUERY = groq`
  *[_type == "drop" && status in ["open", "announced", "soldout"]]
    | order(pickupOrShipDate asc)[0] { ${DROP_FIELDS} }
`;
```

with:

```ts
export const RECENT_DROPS_QUERY = groq`
  *[_type == "drop" && status != "draft"]
    | order(coalesce(ordersCloseAt, pickupOrShipDate, _createdAt) desc)[0...8] {
    ${DROP_FIELDS}
  }
`;
```

- [ ] **Step 3: Update `catalog.ts` imports**

In `src/lib/catalog.ts`, the query import block (lines 4-13) lists `ACTIVE_DROP_QUERY,` first. Replace that single line with `RECENT_DROPS_QUERY,` (keep the rest of the imported names unchanged):

```ts
import {
  ACTIVE_MEMBER_COUNT_QUERY,
  ACTIVE_MEMBERS_QUERY,
  ALL_PRODUCTS_QUERY,
  MEMBER_BY_EMAIL_QUERY,
  MEMBER_SELECTIONS_FOR_DROP_QUERY,
  PRODUCT_BY_SLUG_QUERY,
  PRODUCTS_BY_SLUGS_QUERY,
  RECENT_DROPS_QUERY,
} from "@/sanity/lib/queries";
```

Then update the two local imports just below (lines 15-16). Current:

```ts
import type { MemberSelection } from "./availability";
import { seedDrop, seedProducts } from "./seed-products";
```

Replace with (add the drop-status helpers and `seedPreviousDrops`):

```ts
import type { MemberSelection } from "./availability";
import {
  dropRecencyKey,
  effectiveDropStatus,
  isCurrentDrop,
  isPreviousDrop,
} from "./drop-status";
import { seedDrop, seedPreviousDrops, seedProducts } from "./seed-products";
```

- [ ] **Step 4: Replace `getActiveDrop` and add the list/split helpers**

In `src/lib/catalog.ts`, replace the entire current `getActiveDrop` function (lines 103-123):

```ts
export async function getActiveDrop(opts: FetchOpts = {}): Promise<Drop | null> {
  const fromSanity = await fetchSanity<Drop | null>(ACTIVE_DROP_QUERY, {}, opts);
  if (fromSanity && Array.isArray(fromSanity.lineItems)) {
    const lineItems = fromSanity.lineItems
      .map((li) => {
        const product = normalizeProduct(
          li.product as unknown as Partial<Product>,
        );
        return product ? { product, quantity: li.quantity ?? 0 } : null;
      })
      .filter((li): li is Drop["lineItems"][number] => li !== null);
    // A drop with no usable line items is misconfigured — fall through to the
    // demo drop rather than showing an empty (and unbuyable) storefront.
    if (lineItems.length > 0) return { ...fromSanity, lineItems };
  }
  // Same policy as getProducts(): if there's no usable drop in Sanity (not yet
  // configured, or configured but no `drop` document), fall back to the demo
  // drop so the home page — and its countdowns — always have something to show.
  // Replace it by publishing a real Drop in the Studio.
  return seedDrop();
}
```

with:

```ts
function normalizeDrop(raw: Drop | null | undefined): Drop | null {
  if (!raw || !Array.isArray(raw.lineItems)) return null;
  const lineItems = raw.lineItems
    .map((li) => {
      const product = normalizeProduct(
        li.product as unknown as Partial<Product>,
      );
      return product ? { product, quantity: li.quantity ?? 0 } : null;
    })
    .filter((li): li is Drop["lineItems"][number] => li !== null);
  // A drop with no usable line items is misconfigured — skip it.
  if (lineItems.length === 0) return null;
  return { ...raw, lineItems };
}

async function getRecentDrops(opts: FetchOpts = {}): Promise<Drop[]> {
  const fromSanity = await fetchSanity<Drop[]>(RECENT_DROPS_QUERY, {}, opts);
  if (!Array.isArray(fromSanity)) return [];
  return fromSanity
    .map(normalizeDrop)
    .filter((d): d is Drop => d !== null);
}

/**
 * The home page's view of drops: the effective-current drop plus up to 2
 * most-recently-ended ones. One Sanity round-trip, split in memory. Falls
 * back to bundled seed data when Sanity has no usable drops (zero-config).
 */
export async function getDropsView(
  opts: FetchOpts = {},
): Promise<{ current: Drop | null; previous: Drop[] }> {
  const now = new Date();
  const drops = await getRecentDrops(opts);
  if (drops.length === 0) {
    return { current: seedDrop(), previous: seedPreviousDrops() };
  }
  const current = drops.find((d) => isCurrentDrop(d, now)) ?? null;
  const previous = drops
    .filter((d) => isPreviousDrop(d, now))
    .sort((a, b) => dropRecencyKey(b) - dropRecencyKey(a))
    .slice(0, 2);
  return { current, previous };
}

/**
 * The single effective-current drop (effective status announced/open/soldout),
 * or null. Signature unchanged so all existing callers keep working; they now
 * transparently get time-correct open/close behavior. Falls back to the demo
 * drop only when Sanity has no usable drops at all.
 */
export async function getActiveDrop(opts: FetchOpts = {}): Promise<Drop | null> {
  const now = new Date();
  const drops = await getRecentDrops(opts);
  if (drops.length === 0) return seedDrop();
  return drops.find((d) => isCurrentDrop(d, now)) ?? null;
}
```

- [ ] **Step 5: Use effective status in `getMemberSelectionsForDrop`**

In `src/lib/catalog.ts`, find this block (around lines 149-154):

```ts
  const drop = typeof dropOrId === "object" ? dropOrId : null;
  if (!drop || drop.status === "announced" || drop.status === "draft") {
    // Selection window is still open (or not yet opened) — defaults haven't
    // crystallized yet.
    return explicit;
  }
```

Replace with:

```ts
  const drop = typeof dropOrId === "object" ? dropOrId : null;
  const eff = drop ? effectiveDropStatus(drop, new Date()) : null;
  if (!drop || eff === "announced" || eff === "draft") {
    // Selection window is still open (or not yet opened) — defaults haven't
    // crystallized yet.
    return explicit;
  }
```

- [ ] **Step 6: Verify typecheck + lint pass**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run lint`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/sanity/lib/queries.ts src/lib/catalog.ts
git commit -m "feat: recent-drops query + effective-status catalog split"
```

---

### Task 5: Effective status in availability

**Files:**
- Modify: `src/lib/availability.ts` (imports near top; `buildAvailability` 43-77)

- [ ] **Step 1: Import the helper**

In `src/lib/availability.ts`, the first import line is:

```ts
import type { Drop } from "./types";
```

Add the helper import directly below it:

```ts
import type { Drop } from "./types";
import { effectiveDropStatus } from "./drop-status";
```

- [ ] **Step 2: Add the `now` param and gate on effective status**

Current `buildAvailability` signature and the two status branches:

```ts
export function buildAvailability(
  drop: Drop | null,
  memberSelections: MemberSelection[] = [],
): Map<string, Availability> {
  const map = new Map<string, Availability>();
  if (!drop) return map;
  const open = drop.status === "open";
```

Replace with:

```ts
export function buildAvailability(
  drop: Drop | null,
  memberSelections: MemberSelection[] = [],
  now: Date = new Date(),
): Map<string, Availability> {
  const map = new Map<string, Availability>();
  if (!drop) return map;
  const eff = effectiveDropStatus(drop, now);
  const open = eff === "open";
```

Then, further down, the unavailable-reason line currently reads:

```ts
        reason: drop.status === "announced" ? "not-open" : "soldout",
```

Replace with:

```ts
        reason: eff === "announced" ? "not-open" : "soldout",
```

- [ ] **Step 3: Verify typecheck + lint pass**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/availability.ts
git commit -m "feat: gate availability on effective drop status"
```

---

### Task 6: Effective status gate in checkout

**Files:**
- Modify: `src/app/api/checkout/route.ts` (imports 1-6; gate 56-63)

- [ ] **Step 1: Import the helper**

In `src/app/api/checkout/route.ts`, the import block is:

```ts
import type Stripe from "stripe";

import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { shippingOptions } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";
```

Add the drop-status import (alphabetical within the `@/lib` group):

```ts
import type Stripe from "stripe";

import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { effectiveDropStatus } from "@/lib/drop-status";
import { shippingOptions } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";
```

- [ ] **Step 2: Gate on effective status**

The current authoritative gate:

```ts
  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.status !== "open") {
    return Response.json(
      { error: "Ordering isn't open right now — check the current drop." },
      { status: 409 },
    );
  }
```

Replace with:

```ts
  const drop = await getActiveDrop({ fresh: true });
  if (!drop || effectiveDropStatus(drop, new Date()) !== "open") {
    return Response.json(
      { error: "Ordering isn't open right now — check the current drop." },
      { status: 409 },
    );
  }
```

- [ ] **Step 3: Verify typecheck + lint pass**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/checkout/route.ts
git commit -m "fix: block checkout when drop is effectively closed"
```

---

### Task 7: Previous drops UI component

**Files:**
- Create: `src/components/previous-drops.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/previous-drops.tsx`:

```tsx
import Link from "next/link";

import { ProductImage } from "@/components/product-image";
import type { Drop } from "@/lib/types";

function endedDate(drop: Drop): string | null {
  const src = drop.ordersCloseAt ?? drop.pickupOrShipDate;
  if (!src) return null;
  const ms = new Date(src).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "Previous drops" — the most recently-ended drops (already filtered/capped
 * by getDropsView). Loaves are shown but unbuyable: the FOMO showcase. Renders
 * nothing when there are no previous drops.
 */
export function PreviousDrops({ drops }: { drops: Drop[] }) {
  if (drops.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="display text-4xl sm:text-5xl">Previous drops</h2>
        <p className="text-sm text-ink-500">
          What you missed — flavors come back around.
        </p>
      </div>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2">
        {drops.map((drop) => {
          const when = endedDate(drop);
          return (
            <li key={drop.id} className="nb-card flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="display text-2xl leading-tight">{drop.title}</h3>
                <span className="badge badge-flame">
                  Ended{when ? ` · ${when}` : ""}
                </span>
              </div>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {drop.lineItems.map(({ product }) => (
                  <li key={product.slug}>
                    <Link
                      href={`/product/${product.slug}`}
                      className="block overflow-hidden rounded-2xl border border-ink/10 opacity-75 grayscale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:opacity-100 hover:grayscale-0"
                      title={product.name}
                    >
                      <ProductImage src={product.imageUrl} alt={product.name} />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-700">
                {drop.lineItems.map((li) => li.product.name).join(" · ")}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint pass**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run lint`
Expected: exits 0 (component is unused for now — fine; no unused-import errors because everything imported is used).

- [ ] **Step 3: Commit**

```bash
git add src/components/previous-drops.tsx
git commit -m "feat: add PreviousDrops section component"
```

---

### Task 8: Wire the home page to effective status + Previous drops

**Files:**
- Modify: `src/app/page.tsx` (imports 1-13; data fetch 32-36; badge 110-122; timer 130-156; trust strip 159; new section after 256)

- [ ] **Step 1: Update imports**

Current imports (lines 5-13):

```tsx
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { Countdown } from "@/components/countdown";
import { ProductImage } from "@/components/product-image";
import { availabilityOf, buildAvailability, unavailableLabel } from "@/lib/availability";
import { getActiveDrop, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import type { DropStatus } from "@/lib/types";
```

Replace with (add `PreviousDrops`, swap `getActiveDrop` → `getDropsView`, add `effectiveDropStatus`):

```tsx
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { Countdown } from "@/components/countdown";
import { PreviousDrops } from "@/components/previous-drops";
import { ProductImage } from "@/components/product-image";
import { availabilityOf, buildAvailability, unavailableLabel } from "@/lib/availability";
import { getDropsView, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";
import { effectiveDropStatus } from "@/lib/drop-status";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import type { DropStatus } from "@/lib/types";
```

- [ ] **Step 2: Update the data fetch + derive effective status**

Current (lines 33-36):

```tsx
  const [drop, products] = await Promise.all([getActiveDrop(), getProducts()]);
  const memberSelections = await getMemberSelectionsForDrop(drop);
  const availability = buildAvailability(drop, memberSelections);
  const featured = products.slice(0, 3);
```

Replace with:

```tsx
  const [{ current: drop, previous }, products] = await Promise.all([
    getDropsView(),
    getProducts(),
  ]);
  const now = new Date();
  const eff = drop ? effectiveDropStatus(drop, now) : null;
  const memberSelections = await getMemberSelectionsForDrop(drop);
  const availability = buildAvailability(drop, memberSelections, now);
  const featured = products.slice(0, 3);
```

- [ ] **Step 3: Use `eff` for the status badge**

Current (lines 110-122):

```tsx
          {drop ? (
            <span
              className={`badge ${
                drop.status === "open"
                  ? "badge-sage"
                  : drop.status === "soldout"
                    ? "badge-flame"
                    : ""
              }`}
            >
              {DROP_STATUS_LABEL[drop.status]}
            </span>
          ) : null}
```

Replace with:

```tsx
          {drop && eff ? (
            <span
              className={`badge ${
                eff === "open"
                  ? "badge-sage"
                  : eff === "soldout"
                    ? "badge-flame"
                    : ""
              }`}
            >
              {DROP_STATUS_LABEL[eff]}
            </span>
          ) : null}
```

- [ ] **Step 4: Use `eff` for the countdown timer branch**

Current (lines 132 and 142), inside the timer IIFE:

```tsx
              if (drop.status === "open" && drop.ordersCloseAt) {
```

Replace that line with:

```tsx
              if (eff === "open" && drop.ordersCloseAt) {
```

And the `else if` line:

```tsx
              } else if (drop.status === "announced" && drop.ordersOpenAt) {
```

Replace with:

```tsx
              } else if (eff === "announced" && drop.ordersOpenAt) {
```

- [ ] **Step 5: Use `eff` for the trust-strip guard**

Current (line 159):

```tsx
            {drop.status !== "closed" ? (
```

Replace with:

```tsx
            {eff !== "closed" ? (
```

- [ ] **Step 6: Render `<PreviousDrops>` after the current-drop section**

In `src/app/page.tsx`, the current-drop `<section>` closes at line 256 (`</section>`), immediately followed by the comment banner for the next section (line 258):

```tsx
      </section>

      {/* ======================== HOW DROPS WORK ========================= */}
```

Insert the Previous drops section between them:

```tsx
      </section>

      <PreviousDrops drops={previous} />

      {/* ======================== HOW DROPS WORK ========================= */}
```

- [ ] **Step 7: Verify typecheck + lint pass**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run lint`
Expected: exits 0. (If lint flags `DropStatus` as unused, it is still used by `DROP_STATUS_LABEL` — no change expected.)

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: home page uses effective status + Previous drops section"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run lint`
Expected: exits 0, no errors.
Run: `npm test`
Expected: all `drop-status` tests pass (`# fail 0`).

- [ ] **Step 2: Confirm no stray raw-status gates remain**

Run: `git grep -nE "\.status === \"open\"|\.status !== \"open\"|\.status === \"announced\"" -- src`
Expected: no matches except inside `src/lib/drop-status.ts` (the helper itself). The Stripe webhook's internal GROQ string `status == "open"` in `src/sanity/lib/mutations.ts` uses `==` (GROQ, not JS `===`) so it won't match this pattern anyway, and is expected/intentional (documented soft-close) — leave it.

- [ ] **Step 3: Smoke-test the running app (demo/zero-config path)**

Start `npm run dev` in the background, then wait + check (Bash tool, one block):

```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q 200; do sleep 1; done
curl -s http://localhost:3000/ | grep -c "Previous drops"
```

Expected: the wait loop exits, and the `grep -c` prints a non-zero count (the seed previous-drops section rendered). The home page returns HTTP 200.

- [ ] **Step 4: Manual UI verification (best-effort, state explicitly)**

This environment has no headless browser. In the running dev app, manually verify (or explicitly report as not browser-verified):
- Home page shows the current (seed) drop as buyable and a "Previous drops" section with 2 cards, loaves greyed/unbuyable.
- Temporarily edit `seedDrop()` `ordersCloseAt` to a past date, reload: the current drop's Add-to-Cart is gone/disabled and `POST /api/checkout` returns 409; revert the edit afterward.
- Mobile width: the section and cards reflow to one column cleanly.

- [ ] **Step 5: Final commit (only if Step 4 required a revert or any fixup)**

If no code changed in this task, skip. Otherwise:

```bash
git add -A
git commit -m "chore: verification fixups for previous-drops feature"
```

---

## Notes for the implementer

- **`getActiveDrop` signature is intentionally unchanged.** Its 9 callers (cart, menu, product, club routes, admin pages, checkout, etc.) keep working and now transparently get time-correct open/close behavior. Only `page.tsx` switches to `getDropsView()` (to also receive `previous`).
- **Soft close is intentional.** A checkout completing milliseconds after `ordersCloseAt` can still decrement inventory via the unchanged Stripe webhook. Acceptable at Cottage Food scale; do not add locking.
- **Backward compatible.** A drop with no `ordersOpenAt`/`ordersCloseAt` behaves exactly as its stored status — verified by the "no dates" test in Task 2.
- Storefront freshness is bounded by the existing 60s `revalidate`; the money path (`/api/checkout`) uses `{ fresh: true }` so it is exact.
- **TypeScript test imports use explicit `.ts` extensions** and `tsconfig.json` carries `allowImportingTsExtensions: true` (added in Task 2) — required because the `node:test` runner uses Node's native ESM resolver. Only Task 2 adds test files, so this is contained.
