# Founding Promo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 15%-off, first-5-redemptions founding code that works on both the pay-at-pickup reservation flow and Stripe one-off checkout, plus a founding-member bonus-loaf tag for the first 5 Bread Club subscribers, plus minimal discoverability copy.

**Architecture:** A single Sanity `promoCode` document is the source of truth for code/percent/cap/count. Pure math is unit-tested. The shared counter is incremented by a concurrency-safe `redeemPromo` mutation (rev-guarded, mirrors `setReservationStatus`). Reservations attach the promo at submit but only redeem on owner confirm; Stripe redeems in the webhook on payment completion (over-cap is honored, never clawed back). Bread Club "founding" is a one-time-at-creation boolean on the `member` doc.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Sanity (`next-sanity`), Stripe, `node:test`. Sanity/route/Stripe/React layers have no test harness here — verify via `npm run typecheck` + `npm run lint` + `npm test` (full suite green) + defined manual checks.

**Spec:** `docs/superpowers/specs/2026-05-18-grand-opening-founding-promo-design.md` (Phases 2–4).

**PREREQUISITE:** The Reservation Hardening plan (`2026-05-18-reservation-hardening.md`) must be implemented first — this plan edits the hardened `/api/reserve`, the `unverified` lifecycle, `createReservation`, and `decideReservation`.

---

### Task 1: Pure promo math

**Files:**
- Create: `src/lib/promo-math.ts`
- Test: `src/lib/__tests__/promo-math.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/promo-math.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discountCents,
  discountedTotalCents,
  discountedUnitCents,
} from "../promo-math.ts";

test("discountCents rounds to whole cents", () => {
  assert.equal(discountCents(2200, 15), 330);
  assert.equal(discountCents(1100, 15), 165);
});

test("discountedTotalCents subtracts the rounded discount", () => {
  assert.equal(discountedTotalCents(2200, 15), 1870);
  assert.equal(discountedTotalCents(0, 15), 0);
});

test("discountedUnitCents never goes below 1 cent", () => {
  assert.equal(discountedUnitCents(1100, 15), 935);
  assert.equal(discountedUnitCents(1, 15), 1);
  assert.equal(discountedUnitCents(100, 100), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/promo-math.test.ts`
Expected: FAIL — `Cannot find module '../promo-math.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/promo-math.ts`:

```ts
/** Whole-cent discount for a subtotal at `percentOff` (1–100). Single
 * rounding rule shared by the reservation and Stripe paths. */
export function discountCents(subtotalCents: number, percentOff: number): number {
  return Math.round((subtotalCents * percentOff) / 100);
}

export function discountedTotalCents(
  subtotalCents: number,
  percentOff: number,
): number {
  return Math.max(0, subtotalCents - discountCents(subtotalCents, percentOff));
}

/** Per-unit discounted price for Stripe line items; never below 1 cent
 * (Stripe rejects 0). */
export function discountedUnitCents(
  unitCents: number,
  percentOff: number,
): number {
  return Math.max(1, unitCents - Math.round((unitCents * percentOff) / 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/promo-math.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promo-math.ts src/lib/__tests__/promo-math.test.ts
git commit -m "feat: pure promo discount math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `promoCode` Sanity schema

**Files:**
- Create: `src/sanity/schemaTypes/promoCode.ts`
- Modify: `src/sanity/schemaTypes/index.ts`

- [ ] **Step 1: Create the schema**

Create `src/sanity/schemaTypes/promoCode.ts`:

```ts
import { defineField, defineType } from "sanity";

/**
 * A single-source-of-truth discount code. `redeemedCount` is the shared
 * cross-path counter; only the concurrency-safe `redeemPromo` mutation writes
 * it. Owner-managed in the Studio.
 */
export const promoCodeType = defineType({
  name: "promoCode",
  title: "Promo code",
  type: "document",
  fields: [
    defineField({
      name: "code",
      title: "Code",
      type: "string",
      description: "Case-insensitive. e.g. FOUNDING",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "percentOff",
      title: "Percent off",
      type: "number",
      validation: (r) => r.required().min(1).max(100),
    }),
    defineField({
      name: "maxRedemptions",
      title: "Max redemptions",
      type: "number",
      validation: (r) => r.required().integer().min(1),
    }),
    defineField({
      name: "redeemedCount",
      title: "Redeemed count",
      type: "number",
      initialValue: 0,
      readOnly: true,
      validation: (r) => r.required().integer().min(0),
    }),
    defineField({
      name: "active",
      title: "Active",
      type: "boolean",
      initialValue: true,
    }),
    defineField({ name: "label", title: "Label (admin note)", type: "string" }),
  ],
  preview: {
    select: {
      code: "code",
      pct: "percentOff",
      used: "redeemedCount",
      max: "maxRedemptions",
      active: "active",
    },
    prepare: ({ code, pct, used, max, active }) => ({
      title: `${code ?? "(code)"} — ${pct ?? 0}% off`,
      subtitle: `${used ?? 0}/${max ?? 0} used${active === false ? " · INACTIVE" : ""}`,
    }),
  },
});
```

- [ ] **Step 2: Register it**

In `src/sanity/schemaTypes/index.ts`, add the import after the `orderType` import:

```ts
import { promoCodeType } from "./promoCode";
```

and add `promoCodeType` to the `schemaTypes` array (after `orderType`):

```ts
export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  dropType,
  memberType,
  memberSelectionType,
  reservationType,
  orderType,
  promoCodeType,
];
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/promoCode.ts src/sanity/schemaTypes/index.ts
git commit -m "feat: promoCode Sanity schema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Promo lookup library

**Files:**
- Create: `src/lib/promo.ts`

- [ ] **Step 1: Create the module**

Create `src/lib/promo.ts`:

```ts
import "server-only";

import { sanityClient } from "@/sanity/client";

export type Promo = {
  id: string;
  code: string;
  percentOff: number;
  maxRedemptions: number;
  redeemedCount: number;
  active: boolean;
};

const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;

const ALL_PROMOS_QUERY = `*[_type == "promoCode"]{
  "id": _id, code, percentOff, maxRedemptions,
  "redeemedCount": coalesce(redeemedCount, 0),
  "active": coalesce(active, true)
}`;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Live lookup by normalized code. `null` when Sanity/code absent (zero-config
 * parity: codes simply don't apply, never crash). */
export async function getPromoByCode(code: string): Promise<Promo | null> {
  const norm = normalizeCode(code);
  if (!norm || !sanityClient) return null;
  const client = fresh ?? sanityClient;
  const all = await client.fetch<Promo[]>(
    ALL_PROMOS_QUERY,
    {},
    { cache: "no-store" as const },
  );
  return all.find((p) => normalizeCode(p.code) === norm) ?? null;
}

export function isRedeemable(p: Promo | null): p is Promo {
  return !!p && p.active && p.redeemedCount < p.maxRedemptions;
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/promo.ts
git commit -m "feat: promo lookup library (getPromoByCode/isRedeemable)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Concurrency-safe `redeemPromo` mutation

**Files:**
- Modify: `src/sanity/lib/mutations.ts` (add export at end of file)

- [ ] **Step 1: Add the mutation**

At the end of `src/sanity/lib/mutations.ts`, add:

```ts
/**
 * Atomically claim one redemption of a promo code. Rev-guarded like
 * `setReservationStatus`: succeeds only while the doc is unchanged AND
 * `redeemedCount < maxRedemptions` AND `active`. Per the spec, NEVER throws
 * into callers — a 409 race or any error returns false (caller treats false
 * as "cap hit / not applied"); errors are logged.
 */
export async function redeemPromo(code: string): Promise<boolean> {
  if (!writeClient) return false;
  const norm = code.trim().toUpperCase();
  try {
    const all = await writeClient.fetch<
      {
        _id: string;
        _rev: string;
        code: string;
        maxRedemptions: number;
        redeemedCount?: number;
        active?: boolean;
      }[]
    >(`*[_type == "promoCode"]{ _id, _rev, code, maxRedemptions, redeemedCount, active }`);
    const p = all.find(
      (x) => (x.code ?? "").trim().toUpperCase() === norm,
    );
    if (!p) return false;
    const used = p.redeemedCount ?? 0;
    if (p.active === false || used >= p.maxRedemptions) return false;
    await writeClient
      .patch(p._id)
      .ifRevisionId(p._rev)
      .set({ redeemedCount: used + 1 })
      .commit();
    return true;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return false;
    }
    console.error("[promo] redeemPromo failed", err);
    return false;
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/sanity/lib/mutations.ts
git commit -m "feat: concurrency-safe redeemPromo mutation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Reservation schema + queries — promo fields

**Files:**
- Modify: `src/sanity/schemaTypes/reservation.ts` (after the `totalCents` field, ~line 60)
- Modify: `src/sanity/lib/queries.ts` (`RESERVATION_BY_ID_QUERY` ~line 91, `RESERVATIONS_QUERY` ~line 100)

- [ ] **Step 1: Add schema fields**

In `src/sanity/schemaTypes/reservation.ts`, immediately after the `totalCents` `defineField({ ... })`, add:

```ts
    defineField({ name: "promoCode", title: "Promo code", type: "string", readOnly: true }),
    defineField({ name: "promoPercentOff", title: "Promo % off", type: "number", readOnly: true }),
    defineField({ name: "discountedTotalCents", title: "Discounted total (cents)", type: "number", readOnly: true }),
```

- [ ] **Step 2: Expose them in the queries**

In `src/sanity/lib/queries.ts`, in `RESERVATION_BY_ID_QUERY` change:

```ts
    "dropId": drop._ref, status, totalCents, createdAt, decidedAt,
```
to:
```ts
    "dropId": drop._ref, status, totalCents, createdAt, decidedAt,
    promoCode, promoPercentOff, discountedTotalCents,
```

In `RESERVATIONS_QUERY` change:

```ts
    "dropTitle": drop->title, status, totalCents, createdAt, decidedAt,
```
to:
```ts
    "dropTitle": drop->title, status, totalCents, createdAt, decidedAt,
    promoCode, promoPercentOff, discountedTotalCents,
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/reservation.ts src/sanity/lib/queries.ts
git commit -m "feat: reservation promo fields + query exposure

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `createReservation` accepts promo fields

**Files:**
- Modify: `src/sanity/lib/mutations.ts` (`createReservation`, ~lines 192-214)

- [ ] **Step 1: Extend the input + doc**

In `createReservation`, change the signature object from:

```ts
export async function createReservation(input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId: string;
  items: ReservationItemInput[];
  totalCents: number;
}): Promise<string | null> {
```
to:
```ts
export async function createReservation(input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId: string;
  items: ReservationItemInput[];
  totalCents: number;
  promoCode?: string;
  promoPercentOff?: number;
  discountedTotalCents?: number;
}): Promise<string | null> {
```

and change the `writeClient.create({ ... })` call to include the promo fields conditionally (matching the file's existing conditional-spread style). Replace:

```ts
    totalCents: input.totalCents,
    status: "unverified",
    createdAt: now,
  });
```
with:
```ts
    totalCents: input.totalCents,
    ...(input.promoCode ? { promoCode: input.promoCode } : {}),
    ...(typeof input.promoPercentOff === "number"
      ? { promoPercentOff: input.promoPercentOff }
      : {}),
    ...(typeof input.discountedTotalCents === "number"
      ? { discountedTotalCents: input.discountedTotalCents }
      : {}),
    status: "unverified",
    createdAt: now,
  });
```

(`status: "unverified"` is from the prerequisite hardening plan — keep it.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/sanity/lib/mutations.ts
git commit -m "feat: createReservation persists promo fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Attach promo in `/api/reserve`

**Files:**
- Modify: `src/app/api/reserve/route.ts` (the hardened version from the prerequisite plan)

- [ ] **Step 1: Add imports**

At the top of `src/app/api/reserve/route.ts`, add:

```ts
import { getPromoByCode, isRedeemable, normalizeCode } from "@/lib/promo";
import { discountedTotalCents } from "@/lib/promo-math";
```

- [ ] **Step 2: Accept `code` in the body type**

In the `type Body = { ... }`, add `code?: unknown;`.

- [ ] **Step 3: Resolve the promo before creating the reservation**

In the handler, immediately AFTER the active-drop check (`if (!drop || drop.id === SEED_DROP_ID) { ... }`) and the one-open-per-email anti-flood block, and BEFORE `const id = await createReservation({ ... })`, insert:

```ts
  let promoCode: string | undefined;
  let promoPercentOff: number | undefined;
  let discounted: number | undefined;
  let notice: string | undefined;
  const codeRaw = typeof body.code === "string" ? body.code.trim() : "";
  if (codeRaw) {
    const promo = await getPromoByCode(codeRaw);
    if (isRedeemable(promo)) {
      promoCode = normalizeCode(promo.code);
      promoPercentOff = promo.percentOff;
      discounted = discountedTotalCents(result.totalCents, promo.percentOff);
    } else {
      notice = "That code isn't valid or is fully claimed — reserved at full price.";
    }
  }
```

- [ ] **Step 4: Pass promo fields to `createReservation`**

Change the `createReservation({ ... })` call to add the three promo fields:

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
  });
```

- [ ] **Step 5: Surface the provisional discount + notice**

Change the `emailInput` object so the verify email shows the provisional price, and add `promoPercentOff`:

```ts
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
    totalCents: discounted ?? result.totalCents,
    promoPercentOff,
    pickupDate: drop.pickupOrShipDate,
  };
```

And change the final return from `return Response.json({ ok: true, pendingVerification: true });` to:

```ts
  return Response.json({
    ok: true,
    pendingVerification: true,
    ...(notice ? { notice } : {}),
  });
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — Expected: PASS (note: `promoPercentOff` on `emailInput` requires Task 9's email-type change; if running this task before Task 9, it will fail typecheck — do Task 9 next, or run typecheck after Task 9). Run `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/reserve/route.ts
git commit -m "feat: attach founding promo to reservations (no redeem at submit)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Reserve form — promo code input + notice

**Files:**
- Modify: `src/components/reserve-form.tsx` (hardened version from prerequisite plan)

- [ ] **Step 1: Add state + input + notice**

In `src/components/reserve-form.tsx`:

1. After `const [sent, setSent] = useState(false);` (added by the prerequisite plan), add:

```tsx
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
```

2. In `submit()`, add `code` to the JSON body (alongside `company`/`elapsedMs`):

```tsx
          code: code.trim(),
```

3. In `submit()`, where the success path sets `setSent(true);`, capture any notice first:

```tsx
      setNotice(data.notice ?? null);
      setSent(true);
```

   (The response is already parsed as `data`; widen its type to `{ ok?: boolean; error?: string; notice?: string }`.)

4. In the `if (sent) return (...)` panel, add below the existing paragraph:

```tsx
        {notice ? (
          <p className="mt-3 rounded-2xl panel-mono px-3 py-2 text-sm">{notice}</p>
        ) : null}
```

5. Add the code input inside the details card, after the name/email/phone `.map(...)` block and before the error `<p>`:

```tsx
        <label className="block">
          <span className="text-xs font-semibold uppercase text-ink-500">
            Promo code (optional)
          </span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-ink/20 bg-paper px-3 py-2 uppercase"
            placeholder="FOUNDING"
          />
        </label>
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/reserve-form.tsx
git commit -m "feat: reserve form promo code input + notice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Discount lines in reservation emails

**Files:**
- Modify: `src/lib/reservation-email.ts`

- [ ] **Step 1: Extend the input type**

In `src/lib/reservation-email.ts`, change the `ReservationEmailInput` type to add an optional field:

```ts
export type ReservationEmailInput = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lines: ReservationLine[];
  totalCents: number;
  pickupDate?: string;
  promoPercentOff?: number;
};
```

- [ ] **Step 2: Add a shared discount-note helper**

After the `toItemRows` function, add:

```ts
function discountNoteText(input: ReservationEmailInput): string {
  return input.promoPercentOff
    ? `\n  (Founding discount: ${input.promoPercentOff}% off applied — total above is the discounted amount.)`
    : "";
}
function discountNoteHtml(input: ReservationEmailInput): string {
  return input.promoPercentOff
    ? `<p style="margin:10px 0 0;font-size:13px;color:#6b705c;">Founding discount: ` +
        `<strong>${input.promoPercentOff}% off</strong> applied — the total shown is the discounted amount.</p>`
    : "";
}
```

- [ ] **Step 3: Use it in the verify + confirmed emails**

In `sendReservationVerify` (added by the prerequisite plan), append `discountNoteText(input)` to the text `body` array (add `discountNoteText(input)` as a final array element before `.join("\n")`) and append `discountNoteHtml(input)` to the `bodyHtml` string (after the `lineItemsTable(...)` call, before the "Didn't request this" paragraph).

In `sendReservationConfirmed`, likewise append `discountNoteText(input)` to its `body` array and `discountNoteHtml(input)` to its `bodyHtml` (after the `lineItemsTable(...)` call).

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — Expected: PASS (this also resolves Task 7 Step 6's note).
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservation-email.ts
git commit -m "feat: founding-discount note in reservation emails

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Redeem on owner confirm + over-cap warning

**Files:**
- Modify: `src/lib/reservations.ts`

- [ ] **Step 1: Extend the `Reservation` type + result**

In `src/lib/reservations.ts`, add the promo fields to the local `Reservation` type (after `totalCents: number;`):

```ts
  promoCode?: string;
  promoPercentOff?: number;
  discountedTotalCents?: number;
```

And extend `DecideResult`'s success arm to carry an optional warning:

```ts
export type DecideResult =
  | { ok: true; status: "confirmed" | "declined"; idempotent?: boolean; warning?: string }
  | { ok: false; error: string };
```

- [ ] **Step 2: Make `emailInputFor` pass the discount %**

Change `emailInputFor` to forward `promoPercentOff` and use the discounted total when present:

```ts
function emailInputFor(r: Reservation, pickupDate?: string) {
  const total =
    typeof r.discountedTotalCents === "number" && r.promoCode
      ? r.discountedTotalCents
      : r.totalCents;
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
    totalCents: total,
    promoPercentOff: r.promoCode ? r.promoPercentOff : undefined,
    pickupDate,
  };
}
```

- [ ] **Step 3: Redeem after the confirm claim**

Import `redeemPromo` at the top (add to the existing `@/sanity/lib/mutations` import):

```ts
import {
  decrementDropQuantities,
  redeemPromo,
  setReservationStatus,
} from "@/sanity/lib/mutations";
```

In `decideReservation`, after the successful claim (`const claimed = await setReservationStatus(id, "pending", "confirmed");` and its `if (!claimed) { ... }` block), and BEFORE the `try { await decrementDropQuantities(... )` block, insert:

```ts
    let warning: string | undefined;
    if (r.promoCode) {
      const redeemed = await redeemPromo(r.promoCode);
      if (!redeemed) {
        // Cap exhausted between submit and confirm: confirm at FULL price.
        warning =
          `Founding code "${r.promoCode}" is already fully redeemed — ` +
          `confirmed at full price. Honor the discount manually if you choose.`;
        // Strip the discount so the confirm email shows full price.
        r.promoCode = undefined;
        r.promoPercentOff = undefined;
        r.discountedTotalCents = undefined;
      }
    }
```

- [ ] **Step 4: Return the warning**

Change the final approve return from `return { ok: true, status: "confirmed" };` to:

```ts
    return { ok: true, status: "confirmed", warning };
```

(`emailInputFor` is already called for the confirmed email after the decrement; because Step 3 mutates `r` before that call, the email reflects the correct final price.)

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS (full suite).

- [ ] **Step 6: Commit**

```bash
git add src/lib/reservations.ts
git commit -m "feat: redeem founding code on owner confirm; over-cap full-price fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Surface the over-cap warning to the owner

**Files:**
- Modify: `src/app/api/reservations/decide/route.ts`

- [ ] **Step 1: Show the warning on the magic-link page**

In the `GET` handler, change:

```ts
  return page(
    r.status === "confirmed" ? "Approved ✅" : "Declined",
    r.status === "confirmed"
      ? "Stock is held and the customer was emailed to pay at pickup."
      : "The customer was emailed.",
  );
```
to:
```ts
  const note =
    r.status === "confirmed"
      ? "Stock is held and the customer was emailed to pay at pickup."
      : "The customer was emailed.";
  return page(
    r.status === "confirmed" ? "Approved ✅" : "Declined",
    r.warning ? `${note}<br><br><strong>⚠️ ${r.warning}</strong>` : note,
  );
```

- [ ] **Step 2: Include the warning in the admin POST response**

Change the POST success line:

```ts
  return Response.json({ ok: true, status: r.status, idempotent: r.idempotent ?? false });
```
to:
```ts
  return Response.json({
    ok: true,
    status: r.status,
    idempotent: r.idempotent ?? false,
    ...(r.warning ? { warning: r.warning } : {}),
  });
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/reservations/decide/route.ts
git commit -m "feat: surface founding-code over-cap warning to the owner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Founding code on the Stripe one-off path

**Files:**
- Modify: `src/app/api/checkout/route.ts`

- [ ] **Step 1: Add imports + accept `code`**

At the top of `src/app/api/checkout/route.ts`, add:

```ts
import { getPromoByCode, isRedeemable, normalizeCode } from "@/lib/promo";
import { discountedUnitCents } from "@/lib/promo-math";
```

- [ ] **Step 2: Resolve the promo before building line items**

After `const dropBySlug = new Map(...)` and the member-selections block, and BEFORE the `for (const item of cart)` loop, add:

```ts
  const codeRaw =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? ((body as { code?: string }).code as string).trim()
      : "";
  let promoPercentOff = 0;
  let promoMeta: string | undefined;
  if (codeRaw) {
    const promo = await getPromoByCode(codeRaw);
    if (isRedeemable(promo)) {
      promoPercentOff = promo.percentOff;
      promoMeta = normalizeCode(promo.code);
    }
  }
```

- [ ] **Step 3: Apply the per-unit discount**

In the `for (const item of cart)` loop, change the `lineItems.push({ ... })` so `unit_amount` uses the discount:

```ts
    const unitAmount =
      promoPercentOff > 0
        ? discountedUnitCents(li.product.priceCents, promoPercentOff)
        : li.product.priceCents;
    lineItems.push({
      quantity: item.quantity,
      price_data: {
        currency: "usd",
        unit_amount: unitAmount,
        product_data: {
          name: li.product.name,
          description: li.product.tagline ?? undefined,
          metadata: { slug: li.product.slug },
          ...(li.product.imageUrl ? { images: [li.product.imageUrl] } : {}),
        },
      },
    });
```

- [ ] **Step 4: Put the code in session metadata**

Change `metadata: { cart: cartSummary },` to:

```ts
      metadata: {
        cart: cartSummary,
        ...(promoMeta ? { promo: promoMeta } : {}),
      },
```

(`allow_promotion_codes: true` stays — we apply our discount via `unit_amount`, not a Stripe coupon, so the two don't conflict.)

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/checkout/route.ts
git commit -m "feat: founding code applies on Stripe one-off checkout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Redeem the Stripe redemption in the webhook

**Files:**
- Modify: `src/app/api/webhooks/stripe/route.ts` (`handleCompletedCheckout`)

- [ ] **Step 1: Import `redeemPromo`**

Add `redeemPromo` to the existing `@/sanity/lib/mutations` import:

```ts
import { applyOrderToActiveDrop, createOrder, redeemPromo, upsertMember } from "@/sanity/lib/mutations";
```

- [ ] **Step 2: Redeem on completed payment**

In `handleCompletedCheckout`, right after the `dropId = await applyOrderToActiveDrop(sold);` try/catch block (and before the `const customerEmail = ...` line), add:

```ts
  // Founding code: commit the shared counter on real, completed payments
  // only. Over-cap is HONORED (the customer already paid the discounted
  // amount) — never clawed back; just log a greppable signal.
  const promoMeta = session.metadata?.promo;
  if (session.mode === "payment" && session.livemode && promoMeta) {
    try {
      const ok = await redeemPromo(promoMeta);
      if (!ok) {
        console.warn(`[promo] OVER-CAP REDEMPTION HONORED ${session.id} (${promoMeta})`);
      }
    } catch (err) {
      console.error("[promo] webhook redeem failed", session.id, err);
    }
  }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: redeem founding code on completed Stripe payment (honor over-cap)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Promo code input on the cart (Stripe path)

**Files:**
- Modify: `src/components/cart-contents.tsx`

- [ ] **Step 1: Add state, input, and send the code**

In `src/components/cart-contents.tsx`:

1. The component already uses `useState`. After `const [error, setError] = useState<string | null>(null);` add:

```tsx
  const [code, setCode] = useState("");
```

2. In `checkout()`, change the fetch body to include the code:

```tsx
        body: JSON.stringify({
          code: code.trim(),
          items: rows
            .filter((r) => r.avail.canOrder)
            .map((r) => ({ slug: r.product.slug, quantity: Math.min(r.quantity, r.maxQty) })),
        }),
```

3. In the summary `<aside>`, add the input directly above the primary "Reserve & pay at pickup" link (from the checkout-reorder plan; if that plan is not yet merged, place it above the first CTA button):

```tsx
        <label className="block">
          <span className="text-xs font-semibold uppercase text-ink-500">
            Promo code (optional)
          </span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-ink/20 bg-paper px-3 py-2 text-sm uppercase"
            placeholder="FOUNDING"
          />
        </label>
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Manual verification**

`npm run dev`. With a `promoCode` doc in Sanity (`code: FOUNDING, percentOff: 15, maxRedemptions: 5, active: true, redeemedCount: 0`):
- Cart → enter `founding` (any case) → "Pre-order & pay online" → Stripe Checkout shows ~15%-reduced line prices; the Checkout Session metadata has `promo: FOUNDING`.
- Reservation → enter `FOUNDING` → submit → confirm email link → approve via the baker link: confirm page shows no warning, `redeemedCount` is now 1, confirmed email shows the discounted total + "Founding discount: 15% off".
- Set `redeemedCount: 5` in Sanity, repeat a reservation with the code and approve: confirm page shows the ⚠️ over-cap warning and the email shows full price.

- [ ] **Step 4: Commit**

```bash
git add src/components/cart-contents.tsx
git commit -m "feat: promo code input on the cart

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Bread Club founding-member tag

**Files:**
- Modify: `src/lib/site.ts` (`breadClub` object)
- Modify: `src/sanity/schemaTypes/member.ts`
- Modify: `src/sanity/lib/mutations.ts` (`upsertMember`)
- Modify: `src/sanity/lib/queries.ts` (`ACTIVE_MEMBERS_QUERY`)

- [ ] **Step 1: Add `foundingSeats` config**

In `src/lib/site.ts`, inside the `breadClub` object, after `seats: 12,` add:

```ts
    /** First N members get a bonus loaf in their first delivery (grand
     * opening). Independent of the founding promo-code cap. */
    foundingSeats: 5,
```

- [ ] **Step 2: Add `founding` to the member schema**

In `src/sanity/schemaTypes/member.ts`, after the `priceId` field, add:

```ts
    defineField({
      name: "founding",
      title: "Founding member (bonus loaf in first delivery)",
      type: "boolean",
      readOnly: true,
    }),
```

And update the `preview.prepare` so the owner sees it. Change:

```ts
  preview: {
    select: { email: "customerEmail", status: "subscriptionStatus" },
    prepare: ({ email, status }) => ({
      title: email,
      subtitle: status,
    }),
  },
```
to:
```ts
  preview: {
    select: { email: "customerEmail", status: "subscriptionStatus", founding: "founding" },
    prepare: ({ email, status, founding }) => ({
      title: founding ? `★ FOUNDING — ${email}` : email,
      subtitle: founding ? `${status} · add bonus loaf to first delivery` : status,
    }),
  },
```

- [ ] **Step 3: Assign `founding` once at member creation**

In `src/sanity/lib/mutations.ts`, add `site` to the imports (it is not currently imported):

```ts
import { site } from "@/lib/site";
```

In `upsertMember`, replace the `await writeClient.createIfNotExists({ ... })` block with a pre-check that decides founding only when the doc does not yet exist:

```ts
  const existing = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "member" && _id == $id][0]{ "_id": _id }`,
    { id: docId },
  );
  let founding = false;
  if (!existing) {
    const foundingCount = await writeClient.fetch<number>(
      `count(*[_type == "member" && founding == true])`,
    );
    founding = foundingCount < site.breadClub.foundingSeats;
  }

  await writeClient.createIfNotExists({
    _id: docId,
    _type: "member",
    customerEmail: email,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscriptionStatus: input.subscriptionStatus,
    priceId: input.priceId,
    joinedAt: now,
    lastSyncedAt: now,
    ...(founding ? { founding: true } : {}),
  });
```

The existing `patch` below it is unchanged and does NOT set `founding`, so the flag is assigned exactly once at creation and preserved forever after.

- [ ] **Step 4: Expose `founding` on the active-members query**

In `src/sanity/lib/queries.ts`, in `ACTIVE_MEMBERS_QUERY`, change:

```ts
      "id": _id,
      customerEmail,
      stripeCustomerId,
      subscriptionStatus,
      joinedAt
```
to:
```ts
      "id": _id,
      customerEmail,
      stripeCustomerId,
      subscriptionStatus,
      "founding": coalesce(founding, false),
      joinedAt
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS (full suite).

- [ ] **Step 6: Commit**

```bash
git add src/lib/site.ts src/sanity/schemaTypes/member.ts src/sanity/lib/mutations.ts src/sanity/lib/queries.ts
git commit -m "feat: Bread Club founding-member tag (first 5, set once at creation)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Discoverability copy

**Files:**
- Modify: `src/app/page.tsx` (homepage)
- Modify: `src/app/bread-club/page.tsx`

- [ ] **Step 1: Homepage announcement**

In `src/app/page.tsx`, add a short announcement near the top of the rendered hero section (find the first top-level heading/hero block and place this directly above it; it is a self-contained element):

```tsx
        <p className="badge badge-flame mb-4">
          🎉 Grand opening — first 5 orders get 15% off with code{" "}
          <strong>FOUNDING</strong> · Bread Club founding members get a bonus loaf
        </p>
```

- [ ] **Step 2: Bread Club founding line**

In `src/app/bread-club/page.tsx`, add a founding line to the perks `ul` array (the `.map` over `[emoji, text]` pairs). Add this entry to that array:

```tsx
          ["🎁", `Founding members — the first ${club.seats >= 5 ? 5 : club.seats} to join — get a bonus loaf in their very first delivery.`],
```

(`club` is already `site.breadClub` in scope on that page. The literal "5" mirrors `site.breadClub.foundingSeats`; if that value changes, update this copy — it is display-only.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 4: Manual verification**

`npm run dev`: homepage shows the grand-opening badge; `/bread-club` shows the founding bonus-loaf perk.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/bread-club/page.tsx
git commit -m "feat: grand-opening discoverability copy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phases 2–4):**
- Sanity `promoCode` model + shared lib + concurrency-safe redeem → Tasks 2, 3, 4. ✅
- Reservation path: input, validate-no-redeem at submit, redeem on owner confirm, over-cap full-price + owner warning, discounted emails → Tasks 5–11. ✅
- Stripe path: per-unit discount, `metadata.promo`, `allow_promotion_codes` kept, redeem on completion, over-cap honored + logged → Tasks 12, 13, 14. ✅
- Exact shared rounding rule (`promo-math`) used by both paths → Task 1, used in 7 & 12. ✅
- Zero-config parity (`getPromoByCode` → null when Sanity/code absent; full price, no crash) → Task 3, exercised in 7 & 12. ✅
- Bread Club founding bonus loaf: `foundingSeats` config, `founding` set once at creation, Studio preview, `ACTIVE_MEMBERS_QUERY` exposure → Task 15. ✅
- Discoverability copy (homepage + bread-club) → Task 16. ✅
- **Documented deliberate deferral:** the spec mentioned an inline founding badge in the admin club page (`admin/club/[dropId]/page.tsx`). That page renders from `memberSelection` (keyed by email) while `founding` lives on `member` (keyed by Stripe customer id); an inline badge needs an email→member join — a real sub-feature. The spec's intent ("owner remembers the bonus loaf, no automated tracking — YAGNI") is fully met by the Studio `member` preview (★ FOUNDING + "add bonus loaf" subtitle) and the founding-exposing active-members query, where the owner manages members. The admin-page join is intentionally out of scope and recorded here.

**Placeholder scan:** none — every step has complete code/commands. The one cross-task ordering note (Task 7 typechecks clean only after Task 9's email-type change) is called out explicitly with the resolution, not left implicit. ✅

**Type consistency:** `Promo`, `getPromoByCode`, `isRedeemable`, `normalizeCode` (Task 3) match usage in Tasks 7, 12. `discountCents`/`discountedTotalCents`/`discountedUnitCents` (Task 1) match Tasks 7, 12. `redeemPromo(code): Promise<boolean>` (Task 4) matches Tasks 10, 13. `createReservation` promo params (Task 6) match the call in Task 7. `ReservationEmailInput.promoPercentOff` (Task 9) matches Tasks 7, 10. `DecideResult.warning` (Task 10) matches Task 11. Reservation promo schema/query field names (`promoCode`, `promoPercentOff`, `discountedTotalCents`, Task 5) are consistent across Tasks 6, 7, 10. ✅
