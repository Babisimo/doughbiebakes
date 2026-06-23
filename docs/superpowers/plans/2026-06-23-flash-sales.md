# Flash Sales + Auto-Discounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add time-boxed, auto-applied percentage discounts ("flash sales") to the active drop, surfaced with urgency (banner + countdown + struck-through prices) and applied automatically in both the reserve and online-checkout paths.

**Architecture:** A flash sale is an optional `flashSale` object on the existing Drop document. A pure helper (`flashSaleStatus`) computes whether it's active right now (time-aware, gated to `open` drops), mirroring the existing `effectiveDropStatus`. A second pure helper (`resolveDiscount`) picks the larger of {flash sale, typed promo code} — never stacking. Both the reserve API and the checkout API apply the winner; the storefront shows a banner and sale prices computed from the existing `promo-math` helpers.

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript, Sanity (GROQ schema + queries), Stripe Checkout coupons, `node --test` with `--experimental-strip-types`, Tailwind v4.

## Global Constraints

- **Test runner:** `node --test --experimental-strip-types <file>`. Tests live in `src/lib/__tests__/` and import with explicit `.ts` extensions (e.g. `import { x } from "../foo.ts"`), using `node:assert/strict` and `node:test`.
- **Money is integer cents throughout.** Reuse `discountCents` / `discountedTotalCents` from `src/lib/promo-math.ts`; never hand-roll rounding.
- **Time math is UTC milliseconds** via `new Date(iso).getTime()`, matching `src/lib/drop-status.ts`. No timezone assumptions.
- **`percentOff` is a whole integer 1–100**, matching `promoCode.percentOff` validation.
- **Zero-config parity:** helpers must never throw when `flashSale` is absent (seed drops have none) — return the inactive/full-price result.
- **`promoCode` stays reserved for real redeemable codes.** A flash-sale discount is recorded via `discountLabel`, never by faking a `promoCode` (protects the redemption counter and `redeemPromo` logic).
- **No stacking.** A buyer gets the single larger discount, ties resolve to the flash sale.
- **Commit after each task.** Branch is `feat/flash-sales` (already created).

---

### Task 1: `flashSaleStatus` pure helper + Drop type

**Files:**
- Modify: `src/lib/types.ts` (add `flashSale` to `Drop`)
- Create: `src/lib/flash-sale.ts`
- Test: `src/lib/__tests__/flash-sale.test.ts`

**Interfaces:**
- Consumes: `Drop` type, `effectiveDropStatus(drop, now)` from `src/lib/drop-status.ts`.
- Produces:
  - `Drop.flashSale?: { enabled: boolean; percentOff: number; startsAt?: string; endsAt?: string; headline?: string }`
  - `type FlashSaleState = { active: boolean; percentOff: number; endsAt?: string; headline?: string }`
  - `flashSaleStatus(drop: Drop | null, now: Date): FlashSaleState`

- [ ] **Step 1: Add the `flashSale` field to the `Drop` type**

In `src/lib/types.ts`, inside the `Drop` type (after `lineItems`), add:

```ts
  flashSale?: {
    enabled: boolean;
    percentOff: number;
    startsAt?: string;
    endsAt?: string;
    headline?: string;
  };
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/flash-sale.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { flashSaleStatus } from "../flash-sale.ts";
import type { Drop } from "../types.ts";

const NOW = new Date("2026-06-23T12:00:00.000Z");
const PAST = "2026-06-23T10:00:00.000Z";
const FUTURE = "2026-06-23T14:00:00.000Z";

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

test("inactive when no flashSale present", () => {
  const s = flashSaleStatus(drop({}), NOW);
  assert.deepEqual(s, { active: false, percentOff: 0 });
});

test("inactive when null drop", () => {
  assert.equal(flashSaleStatus(null, NOW).active, false);
});

test("inactive when disabled", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: false, percentOff: 20, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, false);
  assert.equal(s.percentOff, 0);
});

test("active when enabled, within window, drop open, no startsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 20, endsAt: FUTURE, headline: "Surprise!" } }),
    NOW,
  );
  assert.equal(s.active, true);
  assert.equal(s.percentOff, 20);
  assert.equal(s.endsAt, FUTURE);
  assert.equal(s.headline, "Surprise!");
});

test("active when now is between startsAt and endsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15, startsAt: PAST, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, true);
});

test("inactive before startsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15, startsAt: FUTURE, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive after endsAt", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15, endsAt: PAST } }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive when endsAt missing", () => {
  const s = flashSaleStatus(
    drop({ flashSale: { enabled: true, percentOff: 15 } as Drop["flashSale"] }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive when drop is not open (announced)", () => {
  const s = flashSaleStatus(
    drop({
      status: "open",
      ordersOpenAt: FUTURE, // effective status becomes "announced"
      flashSale: { enabled: true, percentOff: 20, endsAt: FUTURE },
    }),
    NOW,
  );
  assert.equal(s.active, false);
});

test("inactive when drop sold out", () => {
  const s = flashSaleStatus(
    drop({ status: "soldout", flashSale: { enabled: true, percentOff: 20, endsAt: FUTURE } }),
    NOW,
  );
  assert.equal(s.active, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/flash-sale.test.ts`
Expected: FAIL — cannot find module `../flash-sale.ts`.

- [ ] **Step 4: Write the minimal implementation**

Create `src/lib/flash-sale.ts`:

```ts
import { effectiveDropStatus } from "./drop-status.ts";
import type { Drop } from "./types.ts";

/**
 * Whether a drop's flash sale is live right now. Time-aware and gated to OPEN
 * drops — a sale only applies while customers can actually buy. Mirrors the
 * UTC-milliseconds comparisons in `drop-status.ts`. Returns full-price
 * (`active: false`, `percentOff: 0`) for any drop without an active sale, so
 * seed/zero-config drops are handled without special-casing.
 */
export type FlashSaleState = {
  active: boolean;
  percentOff: number;
  endsAt?: string;
  headline?: string;
};

const INACTIVE: FlashSaleState = { active: false, percentOff: 0 };

export function flashSaleStatus(drop: Drop | null, now: Date): FlashSaleState {
  const fs = drop?.flashSale;
  if (!drop || !fs || !fs.enabled) return INACTIVE;

  const endsMs = fs.endsAt ? new Date(fs.endsAt).getTime() : NaN;
  if (!Number.isFinite(endsMs)) return INACTIVE;

  const nowMs = now.getTime();
  if (nowMs >= endsMs) return INACTIVE;

  if (fs.startsAt) {
    const startsMs = new Date(fs.startsAt).getTime();
    if (Number.isFinite(startsMs) && nowMs < startsMs) return INACTIVE;
  }

  if (effectiveDropStatus(drop, now) !== "open") return INACTIVE;

  const pct = Math.floor(fs.percentOff);
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) return INACTIVE;

  return { active: true, percentOff: pct, endsAt: fs.endsAt, headline: fs.headline };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/flash-sale.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/types.ts src/lib/flash-sale.ts src/lib/__tests__/flash-sale.test.ts
git commit -m "feat(flash-sale): time-aware flashSaleStatus helper + Drop.flashSale type"
```

---

### Task 2: `resolveDiscount` pure helper

**Files:**
- Modify: `src/lib/flash-sale.ts` (add `resolveDiscount`)
- Test: `src/lib/__tests__/resolve-discount.test.ts`

**Interfaces:**
- Produces:
  - `type DiscountSource = "flash" | "promo" | "none"`
  - `type ResolvedDiscount = { percentOff: number; source: DiscountSource; label?: string }`
  - `resolveDiscount(input: { flashPercent: number; promoPercent: number }): ResolvedDiscount`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/resolve-discount.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDiscount } from "../flash-sale.ts";

test("none when both zero", () => {
  assert.deepEqual(resolveDiscount({ flashPercent: 0, promoPercent: 0 }), {
    percentOff: 0,
    source: "none",
  });
});

test("flash only", () => {
  assert.deepEqual(resolveDiscount({ flashPercent: 20, promoPercent: 0 }), {
    percentOff: 20,
    source: "flash",
    label: "Flash Sale −20%",
  });
});

test("promo only", () => {
  assert.deepEqual(resolveDiscount({ flashPercent: 0, promoPercent: 15 }), {
    percentOff: 15,
    source: "promo",
  });
});

test("larger wins — promo", () => {
  const r = resolveDiscount({ flashPercent: 10, promoPercent: 25 });
  assert.equal(r.source, "promo");
  assert.equal(r.percentOff, 25);
});

test("larger wins — flash", () => {
  const r = resolveDiscount({ flashPercent: 30, promoPercent: 25 });
  assert.equal(r.source, "flash");
  assert.equal(r.percentOff, 30);
  assert.equal(r.label, "Flash Sale −30%");
});

test("tie resolves to flash (no code needed)", () => {
  const r = resolveDiscount({ flashPercent: 20, promoPercent: 20 });
  assert.equal(r.source, "flash");
  assert.equal(r.percentOff, 20);
});

test("label only set for flash source", () => {
  assert.equal(resolveDiscount({ flashPercent: 0, promoPercent: 15 }).label, undefined);
  assert.equal(resolveDiscount({ flashPercent: 0, promoPercent: 0 }).label, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/resolve-discount.test.ts`
Expected: FAIL — `resolveDiscount` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/lib/flash-sale.ts`:

```ts
export type DiscountSource = "flash" | "promo" | "none";

export type ResolvedDiscount = {
  percentOff: number;
  source: DiscountSource;
  /** Human label for a flash-sale discount (no promo code exists). */
  label?: string;
};

/**
 * Pick the single larger discount between an active flash sale and a typed
 * promo code. Never stacks. Ties go to the flash sale (no code to type is the
 * better experience). Pass 0 for whichever isn't present.
 */
export function resolveDiscount(input: {
  flashPercent: number;
  promoPercent: number;
}): ResolvedDiscount {
  const flash = Math.max(0, Math.floor(input.flashPercent) || 0);
  const promo = Math.max(0, Math.floor(input.promoPercent) || 0);
  if (flash === 0 && promo === 0) return { percentOff: 0, source: "none" };
  if (flash >= promo) {
    return { percentOff: flash, source: "flash", label: `Flash Sale −${flash}%` };
  }
  return { percentOff: promo, source: "promo" };
}
```

> Note: the label uses a real minus sign `−` (U+2212), matching the existing reservation copy style.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/resolve-discount.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flash-sale.ts src/lib/__tests__/resolve-discount.test.ts
git commit -m "feat(flash-sale): resolveDiscount — larger-wins, no-stack discount picker"
```

---

### Task 3: Sanity schema field + drop query projection

**Files:**
- Modify: `src/sanity/schemaTypes/drop.ts` (add `flashSale` object field)
- Modify: `src/sanity/lib/queries.ts` (`DROP_FIELDS` projection)

**Interfaces:**
- Consumes: nothing new.
- Produces: published drops now carry `flashSale` through every storefront/API read that uses `DROP_FIELDS`.

- [ ] **Step 1: Add the `flashSale` field to the Drop schema**

In `src/sanity/schemaTypes/drop.ts`, add this field after the `note` field (before `lineItems`):

```ts
    defineField({
      name: "flashSale",
      title: "Flash sale",
      type: "object",
      description:
        "A time-boxed automatic discount. Applies only while this drop is OPEN and now is before 'Ends at'. Leave 'Starts at' blank to go live immediately when enabled.",
      options: { collapsible: true, collapsed: true },
      fields: [
        defineField({
          name: "enabled",
          title: "Enabled",
          type: "boolean",
          initialValue: false,
        }),
        defineField({
          name: "percentOff",
          title: "Percent off",
          type: "number",
          description: "Whole number percent, e.g. 20 for 20% off.",
          validation: (rule) =>
            rule.custom((value, context) => {
              const enabled = (context.parent as { enabled?: boolean })?.enabled;
              if (!enabled) return true;
              if (typeof value !== "number") return "Required when the sale is enabled.";
              if (!Number.isInteger(value) || value < 1 || value > 100)
                return "Must be a whole number between 1 and 100.";
              return true;
            }),
        }),
        defineField({
          name: "startsAt",
          title: "Starts at",
          type: "datetime",
          description: "Optional — blank means the sale is live the moment it's enabled.",
        }),
        defineField({
          name: "endsAt",
          title: "Ends at",
          type: "datetime",
          description: "The urgency deadline. Required when the sale is enabled.",
          validation: (rule) =>
            rule.custom((value, context) => {
              const parent = context.parent as { enabled?: boolean; startsAt?: string };
              if (!parent?.enabled) return true;
              if (!value) return "Required when the sale is enabled.";
              if (parent.startsAt && new Date(value) <= new Date(parent.startsAt))
                return "Must be after 'Starts at'.";
              return true;
            }),
        }),
        defineField({
          name: "headline",
          title: "Headline",
          type: "string",
          description: 'Shown in the banner, e.g. "Surprise Saturday — 20% off everything".',
        }),
      ],
    }),
```

- [ ] **Step 2: Add `flashSale` to the drop query projection**

In `src/sanity/lib/queries.ts`, in the `DROP_FIELDS` constant, add a line after `note,` (and before `"lineItems":`):

```groq
  flashSale,
```

- [ ] **Step 3: Verify the Studio loads and typecheck**

Run: `npm run typecheck`
Expected: passes (no type errors).

Manual check (optional but recommended): `npm run dev`, open `/studio`, open the active drop, confirm the collapsible "Flash sale" section appears and that enabling it without an end date shows a validation error.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/drop.ts src/sanity/lib/queries.ts
git commit -m "feat(flash-sale): Studio flashSale field + drop query projection"
```

---

### Task 4: Apply the discount in the reserve (pay-at-pickup) path

**Files:**
- Modify: `src/sanity/schemaTypes/reservation.ts` (add `discountLabel`)
- Modify: `src/sanity/lib/queries.ts` (`RESERVATION_BY_ID_QUERY`, `RESERVATIONS_QUERY` add `discountLabel`)
- Modify: `src/lib/reservations.ts` (`Reservation` type + `emailInputFor` recognize `discountLabel`)
- Modify: `src/app/api/reserve/route.ts` (resolve flash sale vs code, persist winner)
- Modify: `src/app/api/reservations/verify/route.ts` (`promoApplies` recognizes `discountLabel`)
- Modify: `src/sanity/lib/mutations.ts` (`createReservation` accepts `discountLabel`)

**Interfaces:**
- Consumes: `flashSaleStatus`, `resolveDiscount` (Tasks 1–2), `getActiveDrop`, `discountedTotalCents`, `getPromoByCode`/`isRedeemable`/`normalizeCode`.
- Produces: reservations created with a flash-sale discount store `promoPercentOff` + `discountedTotalCents` + `discountLabel`, with `promoCode` unset.

- [ ] **Step 1: Add `discountLabel` to the reservation schema**

In `src/sanity/schemaTypes/reservation.ts`, after the `discountedTotalCents` field (line ~82), add:

```ts
    defineField({ name: "discountLabel", title: "Discount label", type: "string", readOnly: true, description: "Set for non-code discounts (e.g. a flash sale)." }),
```

- [ ] **Step 2: Fetch `discountLabel` in the reservation queries**

In `src/sanity/lib/queries.ts`:
- In `RESERVATION_BY_ID_QUERY`, change `promoCode, promoPercentOff, discountedTotalCents,` to `promoCode, promoPercentOff, discountedTotalCents, discountLabel,`.
- In `RESERVATIONS_QUERY`, make the same change to its `promoCode, promoPercentOff, discountedTotalCents,` line.

- [ ] **Step 3: Extend `createReservation` to accept `discountLabel`**

In `src/sanity/lib/mutations.ts`, find the `createReservation` function and its input type. Add `discountLabel?: string;` to the parameter type, and include `discountLabel` in the document it creates (alongside `promoCode` / `promoPercentOff` / `discountedTotalCents`). If those fields are written conditionally (only when defined), follow the same pattern:

```ts
    ...(discountLabel ? { discountLabel } : {}),
```

- [ ] **Step 4: Teach `reservations.ts` about `discountLabel`**

In `src/lib/reservations.ts`:
- Add `discountLabel?: string;` to the `Reservation` type (after `discountedTotalCents?`).
- In `emailInputFor`, update the two `r.promoCode`-keyed lines so a flash-sale discount (label, no code) is also recognized:

Replace:

```ts
  const total =
    typeof r.discountedTotalCents === "number" && r.promoCode
      ? r.discountedTotalCents
      : r.totalCents;
  const promoApplies =
    typeof r.discountedTotalCents === "number" && !!r.promoCode;
```

with:

```ts
  const hasDiscount = !!r.promoCode || !!r.discountLabel;
  const total =
    typeof r.discountedTotalCents === "number" && hasDiscount
      ? r.discountedTotalCents
      : r.totalCents;
  const promoApplies =
    typeof r.discountedTotalCents === "number" && hasDiscount;
```

And replace `promoPercentOff: r.promoCode ? r.promoPercentOff : undefined,` with `promoPercentOff: hasDiscount ? r.promoPercentOff : undefined,`.

> Note: the existing `redeemPromo` block in `decideReservation` is guarded by `if (r.promoCode)`, so flash-sale reservations (no `promoCode`) correctly skip code redemption — no change needed there.

- [ ] **Step 5: Resolve and persist the winning discount in the reserve route**

In `src/app/api/reserve/route.ts`:

Add imports at the top (next to the existing promo imports):

```ts
import { flashSaleStatus, resolveDiscount } from "@/lib/flash-sale";
```

Replace the discount block (currently lines ~124–138, the `let promoCode … }` through the trailing `}`):

```ts
  let promoCode: string | undefined;
  let promoPercentOff: number | undefined;
  let discounted: number | undefined;
  let discountLabel: string | undefined;
  let notice: string | undefined;

  const codeRaw = typeof body.code === "string" ? body.code.trim() : "";
  let promoPercent = 0;
  if (codeRaw) {
    const promo = await getPromoByCode(codeRaw);
    if (isRedeemable(promo)) {
      promoPercent = promo.percentOff;
      promoCode = normalizeCode(promo.code);
    } else {
      notice = "That code isn't valid or is fully claimed — reserved at full price.";
    }
  }

  const flash = flashSaleStatus(drop, new Date());
  const winner = resolveDiscount({ flashPercent: flash.percentOff, promoPercent });

  if (winner.source === "flash") {
    // Flash sale beats (or ties) the code: drop the code so the redemption
    // counter is untouched, and record the sale via discountLabel instead.
    promoCode = undefined;
    promoPercentOff = winner.percentOff;
    discountLabel = winner.label;
    discounted = discountedTotalCents(result.totalCents, winner.percentOff);
    if (codeRaw && promoPercent > 0) {
      notice = "A flash sale beat your code — reserved at the bigger discount.";
    }
  } else if (winner.source === "promo") {
    promoPercentOff = winner.percentOff;
    discounted = discountedTotalCents(result.totalCents, winner.percentOff);
  }
```

Then update the `createReservation(...)` call to pass the label:

```ts
  const id = await createReservation({
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    dropId: drop.id,
    items: result.items,
    totalCents: result.totalCents,
    promoCode,
    promoPercentOff,
    discountedTotalCents: discounted,
    discountLabel,
  });
```

And update the `emailInput` object so it shows the discount for either source — change `promoPercentOff,` is already present; ensure `originalTotalCents` stays as `discounted != null ? result.totalCents : undefined` (already correct). Update the log line's promo annotation to also cover flash:

```ts
      (promoCode ? ` [promo ${promoCode} −${promoPercentOff}%]` : discountLabel ? ` [${discountLabel}]` : "") +
```

- [ ] **Step 6: Recognize `discountLabel` in the verify route**

In `src/app/api/reservations/verify/route.ts`:
- Add `discountLabel?: string;` to the inline reservation type (after `discountedTotalCents?: number;`, line ~50).
- Replace `const promoApplies = !!r.promoCode && typeof r.discountedTotalCents === "number";` with:

```ts
        const hasDiscount = !!r.promoCode || !!r.discountLabel;
        const promoApplies =
          hasDiscount && typeof r.discountedTotalCents === "number";
```

- In the `emailInput` object, change `totalCents:` ternary condition `typeof r.discountedTotalCents === "number" && r.promoCode` to `typeof r.discountedTotalCents === "number" && hasDiscount`, and `promoPercentOff: r.promoCode ? r.promoPercentOff : undefined,` to `promoPercentOff: hasDiscount ? r.promoPercentOff : undefined,`.

- [ ] **Step 7: Typecheck + run the full reservation test suite**

Run: `npm run typecheck`
Expected: passes.

Run: `node --test --experimental-strip-types src/lib/__tests__/reservation-eval.test.ts`
Expected: PASS (no behavior change to the evaluator; this confirms nothing regressed).

- [ ] **Step 8: Manual smoke (optional, recommended)**

With `npm run dev` and a Sanity-connected drop: enable a flash sale (20%, no startsAt, endsAt +2h) on the open drop, submit a reservation at `/reserve`, and confirm the server log shows `[Flash Sale −20%]` and the discounted total. Confirm a reservation with no sale is unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/sanity/schemaTypes/reservation.ts src/sanity/lib/queries.ts src/sanity/lib/mutations.ts src/lib/reservations.ts src/app/api/reserve/route.ts src/app/api/reservations/verify/route.ts
git commit -m "feat(flash-sale): apply flash discount in the reserve flow via discountLabel"
```

---

### Task 5: Apply the discount in the online checkout path

**Files:**
- Modify: `src/app/api/checkout/route.ts`

**Interfaces:**
- Consumes: `flashSaleStatus`, `resolveDiscount`, the existing `drop` already fetched in the route.
- Produces: the Stripe session applies the winning percent as a reusable coupon; metadata records the discount source.

- [ ] **Step 1: Rename `ensureFoundingCoupon` → `ensurePercentCoupon` (general percent coupon)**

In `src/app/api/checkout/route.ts`, replace the `ensureFoundingCoupon` function with:

```ts
/**
 * A reusable Stripe coupon keyed by percent, so it's created once and shared
 * across orders (founding code, flash sale, or any percent discount). Applied
 * as a session-level discount so it comes off the order TOTAL.
 */
async function ensurePercentCoupon(
  stripe: Stripe,
  percentOff: number,
): Promise<string> {
  const id = `pct-${percentOff}pct`;
  try {
    await stripe.coupons.create({
      id,
      percent_off: percentOff,
      duration: "once",
      name: `${percentOff}% off`,
    });
  } catch (err) {
    if ((err as { code?: string })?.code !== "resource_already_exists") throw err;
  }
  return id;
}
```

- [ ] **Step 2: Resolve flash vs code and apply the winner**

Add the import near the top:

```ts
import { flashSaleStatus, resolveDiscount } from "@/lib/flash-sale";
```

Replace the existing code-resolution block (currently lines ~121–133, `const codeRaw … }`):

```ts
  const codeRaw =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? ((body as { code?: string }).code as string).trim()
      : "";
  let promoPercent = 0;
  let promoMeta: string | undefined;
  if (codeRaw) {
    const promo = await getPromoByCode(codeRaw);
    if (isRedeemable(promo)) {
      promoPercent = promo.percentOff;
      promoMeta = normalizeCode(promo.code);
    }
  }

  const flash = flashSaleStatus(drop, new Date());
  const winner = resolveDiscount({ flashPercent: flash.percentOff, promoPercent });
  const promoPercentOff = winner.source === "promo" ? winner.percentOff : 0;
  const discountPercent = winner.percentOff;
  // Only a real code redemption is tracked in metadata `promo`; a flash sale is
  // tagged separately so the webhook/order log can tell them apart.
  const discountMeta =
    winner.source === "promo" ? promoMeta : winner.source === "flash" ? winner.label : undefined;
```

> `promoPercentOff` is kept as a named value only if other code references it; if nothing else in the file uses it after this change, omit that line and use `discountPercent` directly in the next step.

- [ ] **Step 3: Use the winning percent for the coupon**

Replace:

```ts
  const couponId =
    promoPercentOff > 0 ? await ensureFoundingCoupon(stripe, promoPercentOff) : null;
```

with:

```ts
  const couponId =
    discountPercent > 0 ? await ensurePercentCoupon(stripe, discountPercent) : null;
```

- [ ] **Step 4: Record the discount in session metadata**

In the `metadata` object of `stripe.checkout.sessions.create`, replace `...(promoMeta ? { promo: promoMeta } : {}),` with:

```ts
        ...(winner.source === "promo" && promoMeta ? { promo: promoMeta } : {}),
        ...(winner.source === "flash" ? { flashSale: `${discountPercent}` } : {}),
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes. (If the compiler flags an unused `promoPercentOff`, remove that line per the Step 2 note.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/checkout/route.ts
git commit -m "feat(flash-sale): apply flash discount at online checkout via percent coupon"
```

---

### Task 6: Flash sale banner (storefront urgency)

**Files:**
- Create: `src/components/flash-sale-banner.tsx`
- Modify: `src/app/page.tsx` (home)
- Modify: `src/app/menu/page.tsx`
- Modify: `src/app/cart/page.tsx`

**Interfaces:**
- Consumes: `FlashSaleState` from `src/lib/flash-sale.ts`, the existing `Countdown` component.
- Produces: `<FlashSaleBanner state={FlashSaleState} />` — renders nothing when `state.active` is false.

- [ ] **Step 1: Create the banner component**

Create `src/components/flash-sale-banner.tsx`:

```tsx
import { Countdown } from "@/components/countdown";
import type { FlashSaleState } from "@/lib/flash-sale";

/**
 * Urgency banner for a live flash sale. Server-rendered from a `FlashSaleState`
 * (computed via `flashSaleStatus`); only the embedded `Countdown` ticks on the
 * client. Renders nothing when no sale is active.
 */
export function FlashSaleBanner({ state }: { state: FlashSaleState }) {
  if (!state.active) return null;
  return (
    <div className="panel-acid mx-auto flex w-full max-w-3xl flex-col items-center gap-2 rounded-3xl border border-ink/15 px-5 py-4 text-center shadow-[var(--shadow-hard-sm)] sm:flex-row sm:justify-between sm:text-left">
      <p className="display text-lg leading-tight sm:text-xl">
        ⚡ {state.headline ?? "Flash Sale"} —{" "}
        <span className="text-grad-acid">{state.percentOff}% off</span>
      </p>
      <Countdown to={state.endsAt} label="Ends in" tone="acid" />
    </div>
  );
}
```

> If `panel-acid` / `text-grad-acid` / `--shadow-hard-sm` aren't the right tokens, use the closest existing ones from `src/app/globals.css` (the README lists `.panel-acid`, `.text-grad-acid`, `.badge-acid`). Match the surrounding pages' card styling.

- [ ] **Step 2: Render it on the home page**

In `src/app/page.tsx`, the active drop is already fetched. Import the helper and banner:

```tsx
import { flashSaleStatus } from "@/lib/flash-sale";
import { FlashSaleBanner } from "@/components/flash-sale-banner";
```

Compute the state from the drop the page already has (use the same variable the page uses for the current drop; call it `drop` below) and render the banner near the top of the hero/current-drop section:

```tsx
<FlashSaleBanner state={flashSaleStatus(drop, new Date())} />
```

If the page is a server component without a `drop` in scope at the render point, compute `const flash = flashSaleStatus(drop, new Date());` right after the drop is fetched and pass `flash` down.

- [ ] **Step 3: Render it on the menu page**

In `src/app/menu/page.tsx`, fetch/obtain the active drop (the page already needs it for availability). Add the same import and render `<FlashSaleBanner state={flashSaleStatus(drop, new Date())} />` above the product grid.

- [ ] **Step 4: Render it on the cart page**

`src/app/cart/page.tsx` — if it's a client component, fetch the active drop's flash state from a server source it already uses, or compute it in the nearest server parent and pass `state` as a prop. Render `<FlashSaleBanner state={state} />` at the top of the cart. (Minimal version: render only if a server-provided `state` prop is present.)

- [ ] **Step 5: Typecheck + visual check**

Run: `npm run typecheck`
Expected: passes.

Run `npm run dev`, enable a flash sale on the open drop, and confirm the banner with a live countdown appears on home, menu, and cart, and disappears when the sale is disabled or its `endsAt` is in the past.

- [ ] **Step 6: Commit**

```bash
git add src/components/flash-sale-banner.tsx src/app/page.tsx src/app/menu/page.tsx src/app/cart/page.tsx
git commit -m "feat(flash-sale): urgency banner with live countdown on home/menu/cart"
```

---

### Task 7: Struck-through sale prices

**Files:**
- Create: `src/components/sale-price.tsx`
- Modify: `src/components/product-card.tsx`
- Modify: `src/app/product/[slug]/page.tsx`
- Modify: `src/app/menu/page.tsx` (pass `salePercentOff` into `ProductCard`)
- Modify: `src/app/page.tsx` (pass `salePercentOff` into any `ProductCard` in the menu peek)

**Interfaces:**
- Consumes: `discountedTotalCents` from `src/lib/promo-math.ts`, `formatPrice` from `src/lib/money.ts`.
- Produces: `<SalePrice cents={number} percentOff={number} />` — renders the plain price when `percentOff <= 0`, else struck original + sale price. `ProductCard` gains an optional `salePercentOff?: number` prop (default 0).

- [ ] **Step 1: Create the `SalePrice` component**

Create `src/components/sale-price.tsx`:

```tsx
import { formatPrice } from "@/lib/money";
import { discountedTotalCents } from "@/lib/promo-math";

/**
 * A price that shows a struck-through original next to the discounted price
 * when a flash sale is active. With `percentOff <= 0` it renders exactly the
 * normal price (zero visual change off-sale).
 */
export function SalePrice({
  cents,
  percentOff,
  className = "",
}: {
  cents: number;
  percentOff: number;
  className?: string;
}) {
  if (!percentOff || percentOff <= 0) {
    return (
      <span className={`rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink ${className}`}>
        {formatPrice(cents)}
      </span>
    );
  }
  const sale = discountedTotalCents(cents, percentOff);
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-sm font-semibold text-ink-500 line-through">{formatPrice(cents)}</span>
      <span className="rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink">
        {formatPrice(sale)}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Use `SalePrice` in `ProductCard`**

In `src/components/product-card.tsx`:
- Add `salePercentOff = 0` to the props (after `priority = false`), typed `salePercentOff?: number`.
- Add the import: `import { SalePrice } from "@/components/sale-price";`.
- Replace the price pill (lines ~49–51):

```tsx
          <SalePrice
            cents={product.priceCents}
            percentOff={salePercentOff}
            className="shrink-0"
          />
```

- [ ] **Step 3: Pass `salePercentOff` from the menu page**

In `src/app/menu/page.tsx`, compute `const flash = flashSaleStatus(drop, new Date());` once, then pass `salePercentOff={flash.active ? flash.percentOff : 0}` to every `<ProductCard ... />`. Add the `flashSaleStatus` import if not already present from Task 6.

- [ ] **Step 4: Pass `salePercentOff` from the home page menu peek**

In `src/app/page.tsx`, reuse the `flash` computed in Task 6 and pass `salePercentOff={flash.active ? flash.percentOff : 0}` to any `<ProductCard />` rendered in the menu-peek section.

- [ ] **Step 5: Show the sale price on the product detail page**

In `src/app/product/[slug]/page.tsx`, fetch the active drop (the page already resolves availability against the open drop), compute `const flash = flashSaleStatus(drop, new Date());`, and render the product's price with `<SalePrice cents={product.priceCents} percentOff={flash.active ? flash.percentOff : 0} />` wherever the price is currently shown. Add the imports for `SalePrice` and `flashSaleStatus`.

- [ ] **Step 6: Typecheck + visual check**

Run: `npm run typecheck`
Expected: passes.

`npm run dev`: with a 20% sale enabled, confirm product cards (menu + home peek) and the product page show `~~$X~~ $Y`; with the sale off, prices look exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/components/sale-price.tsx src/components/product-card.tsx src/app/product/[slug]/page.tsx src/app/menu/page.tsx src/app/page.tsx
git commit -m "feat(flash-sale): struck-through sale prices on cards + product page"
```

---

### Task 8: Full suite + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: all tests pass, including the new `flash-sale.test.ts` and `resolve-discount.test.ts`.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both pass clean.

- [ ] **Step 3: End-to-end manual pass (recommended)**

With a Sanity-connected open drop and `npm run dev`:
1. Enable flash sale (20%, no `startsAt`, `endsAt` = +1h). Banner + countdown show on home/menu/cart; cards show struck prices.
2. Reserve a loaf → server log shows `[Flash Sale −20%]`, discounted total; verify email reflects the discount.
3. Set `endsAt` to the past → banner gone, prices full, reserve at full price.
4. (If online payments enabled) checkout with the sale active → Stripe session total reflects the discount; metadata has `flashSale`.
5. With both a valid promo code and a smaller flash sale → the larger one wins; with a larger flash sale and a code → flash wins and the code is not redeemed (counter unchanged).

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(flash-sale): full-suite verification pass"
```

---

## Self-Review notes

- **Spec coverage:** data model (Task 1, 3), `flashSaleStatus` (Task 1), `resolveDiscount` + no-stack/larger-wins (Task 2), reserve path + `discountLabel` (Task 4), online checkout + `ensurePercentCoupon` (Task 5), banner (Task 6), struck prices (Task 7), edge cases & tests (Tasks 1–2, 8). The spec's "scarcity nudges" item is explicitly out of scope.
- **Type consistency:** `flashSaleStatus`, `FlashSaleState`, `resolveDiscount`, `ResolvedDiscount`, `DiscountSource`, and the `discountLabel` field name are used identically across all tasks.
- **No placeholders:** every code step shows the actual code. The two "if not already present"/token notes are deliberate guardrails for the implementer, not deferred work.
