# Bread Club Per-Drop Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Bread Club's $40/4-week Stripe subscription with a card-on-file, charge-per-drop model: $10 per drop, baker-triggered, members opt out by skipping, manual-only membership removal.

**Architecture:** No Stripe subscription. At join, a Stripe `setup`-mode Checkout saves a card on the customer. The baker clicks "Charge members for this drop" in the admin, which charges each participating `active` member with an off-session PaymentIntent. A deterministic-id `memberCharge` doc per (drop, member) makes charging idempotent. Membership lives in the Sanity `member` doc (`active`/`canceled`).

**Tech Stack:** Next.js 16 App Router, TypeScript, Sanity (`next-sanity`), Stripe SDK `^22` (`getStripe()`, API version `2026-04-22.dahlia`), `node:test`. No test harness exists for routes/schemas/React — those tasks verify via `npm run typecheck` + `npm run lint` + `npm test` (full suite green) + a defined manual check. Pure logic gets real `node:test` tests.

**Spec:** `docs/superpowers/specs/2026-05-20-bread-club-per-drop-billing-design.md`

**No migration:** the Bread Club has no members; schemas are redesigned freely.

---

## File structure

| File | Change |
|---|---|
| `src/sanity/schemaTypes/member.ts` | Redesign — drop subscription fields, add `status`/`stripePaymentMethodId`/`canceledAt` |
| `src/sanity/schemaTypes/memberSelection.ts` | `+skipped`, `−shipInvoiceItemId` |
| `src/sanity/schemaTypes/memberCharge.ts` | **New** — per-drop-per-member charge record |
| `src/sanity/schemaTypes/index.ts` | Register `memberChargeType` |
| `src/sanity/lib/queries.ts` | Member queries → `status == "active"`; new charge queries |
| `src/sanity/lib/mutations.ts` | Replace `upsertMember`; add `createClubMember`/`setMemberCard`/`cancelMember`/`recordMemberCharge`; adjust `upsertMemberSelection` |
| `src/lib/catalog.ts` | `getMemberSelectionsForDrop` skip handling; member-fetch types; `getMemberChargesForDrop` |
| `src/lib/club-billing.ts` | **New, pure** — `dropChargeCents`, `shouldChargeMember` |
| `src/lib/club-token.ts` | Add member-keyed token (`signClubMemberToken`/`verifyClubMemberToken`) |
| `src/lib/club-emails.ts` | **New** — decline email |
| `src/app/api/bread-club/route.ts` | Rewrite → `setup`-mode checkout |
| `src/app/api/webhooks/stripe/route.ts` | Handle `mode: "setup"`; delete subscription handling |
| `src/app/api/admin/club/charge/route.ts` | **New** — the charge action |
| `src/app/api/admin/club/remove/route.ts` | **New** — manual member removal |
| `src/app/api/club/select/route.ts` | Rewrite — remove invoice-item logic, add skip |
| `src/app/api/club/cancel/route.ts` | **New** — self-cancel magic link |
| `src/app/api/club/update-card/route.ts` | **New** — card-update magic link |
| `src/app/club/[dropId]/selection-form.tsx` | Add "Skip this drop" |
| `src/app/admin/club/[dropId]/page.tsx` | "Charge members" + "Remove from club" UI |
| `src/components/club-charge-button.tsx` | **New** — client charge button |
| `src/components/club-member-row-actions.tsx` | **New** — client remove button |
| `src/app/bread-club/page.tsx` | Copy update |
| `src/lib/site.ts` | `breadClub` config |

---

# Phase 1 — Data model & data access

### Task 1: Redesign the `member` schema

**Files:** Modify `src/sanity/schemaTypes/member.ts`

- [ ] **Step 1: Replace the field list + preview**

Replace the entire `fields` array and `preview` of `memberType` so the schema is:

```ts
import { defineField, defineType } from "sanity";

/**
 * A Bread Club member. Created by the Stripe webhook on a completed
 * `setup`-mode Checkout (the join flow). `_id` is the Stripe customer id so
 * creation is idempotent. There is no Stripe subscription — billing is
 * per-drop (see `memberCharge`).
 */
export const memberType = defineType({
  name: "member",
  title: "Member",
  type: "document",
  fields: [
    defineField({
      name: "customerEmail",
      title: "Email",
      type: "string",
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: "stripeCustomerId",
      title: "Stripe customer id",
      type: "string",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "stripePaymentMethodId",
      title: "Saved card (Stripe payment method id)",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Active", value: "active" },
          { title: "Canceled", value: "canceled" },
        ],
        layout: "radio",
      },
      initialValue: "active",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "joinedAt",
      title: "Joined at",
      type: "datetime",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "canceledAt", title: "Canceled at", type: "datetime", readOnly: true }),
    defineField({
      name: "founding",
      title: "Founding member (bonus loaf in first delivery)",
      type: "boolean",
      readOnly: true,
    }),
  ],
  preview: {
    select: { email: "customerEmail", status: "status", founding: "founding" },
    prepare: ({ email, status, founding }) => ({
      title: founding ? `★ FOUNDING — ${email}` : email,
      subtitle: founding ? `${status} · add bonus loaf to first delivery` : status,
    }),
  },
});
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — expect FAIL (other files still reference removed fields like `subscriptionStatus`; later tasks fix them). Run `npm run lint` on this file's syntax only by eye. This task's schema is self-consistent; the suite goes green at the end of Phase 1.

- [ ] **Step 3: Commit**

```
git add src/sanity/schemaTypes/member.ts
git commit -m "feat: redesign member schema for per-drop billing (no subscription)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `memberSelection` — add `skipped`, drop `shipInvoiceItemId`

**Files:** Modify `src/sanity/schemaTypes/memberSelection.ts`

- [ ] **Step 1: Apply the field changes**

In `memberSelectionType.fields`: **delete** the entire `shipInvoiceItemId` `defineField({...})`. Make `productSlug` no longer required (a skipped selection has no loaf) — change its `validation` from `(rule) => rule.required()` to removing the `validation` line entirely. After the `fulfillment` field, **add**:

```ts
    defineField({
      name: "skipped",
      title: "Skipped this drop",
      type: "boolean",
      description: "True when the member opted out of this drop — no loaf, no charge.",
    }),
```

Update the `preview.prepare` to handle a skipped selection:

```ts
  preview: {
    select: { email: "customerEmail", slug: "productSlug", skipped: "skipped", at: "selectedAt" },
    prepare: ({ email, slug, skipped, at }) => ({
      title: skipped ? `${email} → (skipped)` : `${email} → ${slug ?? "(default)"}`,
      subtitle: at ? new Date(at).toLocaleString() : "",
    }),
  },
```

- [ ] **Step 2: Verify**

`npm run typecheck` (suite not yet green — Phase 1 finishes it). Confirm the schema reads cleanly.

- [ ] **Step 3: Commit**

```
git add src/sanity/schemaTypes/memberSelection.ts
git commit -m "feat: memberSelection gains skipped, drops subscription ship-item

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: New `memberCharge` schema

**Files:** Create `src/sanity/schemaTypes/memberCharge.ts`; Modify `src/sanity/schemaTypes/index.ts`

- [ ] **Step 1: Create the schema**

Create `src/sanity/schemaTypes/memberCharge.ts`:

```ts
import { defineField, defineType } from "sanity";

/**
 * One $10-per-drop charge attempt for a member. Written by the per-drop
 * charge route. `_id = charge.<dropId>.<stripeCustomerId>` is deterministic
 * so a member can't be charged twice for one drop.
 */
export const memberChargeType = defineType({
  name: "memberCharge",
  title: "Member charge",
  type: "document",
  fields: [
    defineField({ name: "member", title: "Member", type: "reference", to: [{ type: "member" }], readOnly: true }),
    defineField({ name: "drop", title: "Drop", type: "reference", to: [{ type: "drop" }], readOnly: true }),
    defineField({ name: "customerEmail", title: "Member email", type: "string", readOnly: true }),
    defineField({ name: "amountCents", title: "Amount (cents)", type: "number", readOnly: true }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: { list: [ { title: "Paid", value: "paid" }, { title: "Failed", value: "failed" } ], layout: "radio" },
      readOnly: true,
    }),
    defineField({ name: "stripePaymentIntentId", title: "Stripe PaymentIntent id", type: "string", readOnly: true }),
    defineField({ name: "failureMessage", title: "Failure message", type: "string", readOnly: true }),
    defineField({ name: "chargedAt", title: "Charged at", type: "datetime", readOnly: true }),
  ],
  preview: {
    select: { email: "customerEmail", status: "status", amount: "amountCents" },
    prepare: ({ email, status, amount }) => ({
      title: `${email ?? "(member)"} — ${status ?? "?"}`,
      subtitle: typeof amount === "number" ? `$${(amount / 100).toFixed(2)}` : undefined,
    }),
  },
});
```

- [ ] **Step 2: Register it**

In `src/sanity/schemaTypes/index.ts`: add `import { memberChargeType } from "./memberCharge";` after the `memberSelectionType` import, and add `memberChargeType` to the `schemaTypes` array (after `memberSelectionType`).

- [ ] **Step 3: Verify & commit**

`npm run typecheck`. Then:

```
git add src/sanity/schemaTypes/memberCharge.ts src/sanity/schemaTypes/index.ts
git commit -m "feat: memberCharge schema for per-drop charge records

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pure billing helpers (TDD)

**Files:** Create `src/lib/club-billing.ts`; Test `src/lib/__tests__/club-billing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/club-billing.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropChargeCents, shouldChargeMember } from "../club-billing.ts";

test("dropChargeCents: $10 pickup, $22 ship", () => {
  assert.equal(dropChargeCents("pickup"), 1000);
  assert.equal(dropChargeCents("ship"), 2200);
});

test("shouldChargeMember: charge a member with no selection (silent = in)", () => {
  assert.equal(shouldChargeMember(null, null), true);
});

test("shouldChargeMember: charge a member who picked a loaf", () => {
  assert.equal(shouldChargeMember({ skipped: false }, null), true);
});

test("shouldChargeMember: do NOT charge a skipped member", () => {
  assert.equal(shouldChargeMember({ skipped: true }, null), false);
});

test("shouldChargeMember: do NOT re-charge an already-paid member", () => {
  assert.equal(shouldChargeMember(null, "paid"), false);
  assert.equal(shouldChargeMember({ skipped: false }, "paid"), false);
});

test("shouldChargeMember: DO retry a previously-failed member", () => {
  assert.equal(shouldChargeMember(null, "failed"), true);
  assert.equal(shouldChargeMember({ skipped: false }, "failed"), true);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/club-billing.test.ts`
Expected: FAIL — `Cannot find module '../club-billing.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/club-billing.ts`:

```ts
import { site } from "./site.ts";

/** Whole-dollar Bread Club drop price (cents) — $10, plus the ship surcharge
 * when the member chose shipping over free local pickup. */
export function dropChargeCents(fulfillment: "pickup" | "ship"): number {
  const base = 1000;
  return fulfillment === "ship" ? base + site.breadClub.shipSurchargeCents : base;
}

/**
 * Whether the per-drop charge run should attempt a charge for a member.
 * `selection` is the member's memberSelection for this drop (null = silent);
 * `existingChargeStatus` is any prior memberCharge for (drop, member).
 * Skipped members and already-paid members are not charged; a prior failure
 * is retried; silence means "in" (charge + default loaf).
 */
export function shouldChargeMember(
  selection: { skipped?: boolean } | null,
  existingChargeStatus: "paid" | "failed" | null,
): boolean {
  if (selection?.skipped) return false;
  if (existingChargeStatus === "paid") return false;
  return true;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/club-billing.test.ts`
Expected: PASS (6 tests). `node:test` resolves sibling imports with the `.ts` extension — `./site.ts` is correct.

- [ ] **Step 5: Commit**

```
git add src/lib/club-billing.ts src/lib/__tests__/club-billing.test.ts
git commit -m "feat: pure Bread Club per-drop billing helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Member-keyed magic-link token (TDD)

**Files:** Modify `src/lib/club-token.ts`; Test `src/lib/__tests__/club-token.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/club-token.test.ts` (or append if it exists):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  signClubMemberToken,
  verifyClubMemberToken,
} from "../club-token.ts";

process.env.CLUB_LINK_SECRET ||= "test-secret-at-least-16-chars-long";

test("club member token round-trips", () => {
  const t = signClubMemberToken("cus_ABC123");
  assert.equal(verifyClubMemberToken("cus_ABC123", t), true);
});

test("club member token rejects a different customer", () => {
  const t = signClubMemberToken("cus_ABC123");
  assert.equal(verifyClubMemberToken("cus_XYZ999", t), false);
});

test("club member token rejects garbage/empty", () => {
  assert.equal(verifyClubMemberToken("cus_ABC123", "deadbeef"), false);
  assert.equal(verifyClubMemberToken("cus_ABC123", ""), false);
  assert.equal(verifyClubMemberToken("", "deadbeef"), false);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/club-token.test.ts`
Expected: FAIL — `signClubMemberToken` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/club-token.ts`, add (after the existing `verifyClubToken` function):

```ts
/** Member-scoped magic-link token (cancel, card-update) — HMAC of the Stripe
 * customer id, distinct namespace from the per-drop token via the `member:`
 * prefix. */
export function signClubMemberToken(customerId: string): string {
  return createHmac("sha256", getSecret())
    .update(`member:${customerId}`)
    .digest("hex");
}

export function verifyClubMemberToken(customerId: string, token: string): boolean {
  if (!customerId || !token) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(signClubMemberToken(customerId), "hex");
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

(`createHmac`, `timingSafeEqual`, and `getSecret` are already imported/defined in the file.)

- [ ] **Step 4: Run — verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/club-token.test.ts` → PASS.

- [ ] **Step 5: Commit**

```
git add src/lib/club-token.ts src/lib/__tests__/club-token.test.ts
git commit -m "feat: member-keyed Bread Club magic-link token

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Queries — member status + charge queries

**Files:** Modify `src/sanity/lib/queries.ts`

- [ ] **Step 1: Update member queries to use `status`**

In `src/sanity/lib/queries.ts`:

- `ACTIVE_MEMBERS_QUERY` — change the filter `subscriptionStatus in ["active", "trialing"]` to `status == "active"`, and change its projection to:
  ```
      "id": _id,
      customerEmail,
      stripeCustomerId,
      stripePaymentMethodId,
      "founding": coalesce(founding, false),
      joinedAt
  ```
- `ACTIVE_MEMBER_COUNT_QUERY` — change `subscriptionStatus in ["active", "trialing"]` to `status == "active"`.
- `MEMBER_BY_EMAIL_QUERY` — change the projection from `stripeCustomerId, subscriptionStatus, customerEmail` to `stripeCustomerId, status, customerEmail` (filter unchanged — looks up by email regardless of status).
- `FOUNDING_MEMBER_COUNT_QUERY` — leave unchanged (founding is permanent, status-independent).

- [ ] **Step 2: Add the charge queries**

Append to `src/sanity/lib/queries.ts`:

```ts
// All memberSelection docs for a drop, raw (includes skipped ones) — the
// per-drop charge route needs skip + fulfillment per member.
export const MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY = groq`
  *[_type == "memberSelection" && drop._ref == $dropId]{
    customerEmail, productSlug, "fulfillment": coalesce(fulfillment, "pickup"),
    "skipped": coalesce(skipped, false)
  }`;

// memberCharge docs for a drop — so the charge run knows who's already paid.
export const MEMBER_CHARGES_FOR_DROP_QUERY = groq`
  *[_type == "memberCharge" && drop._ref == $dropId]{
    "id": _id, "customerId": member._ref, customerEmail, status,
    amountCents, failureMessage
  }`;
```

- [ ] **Step 3: Verify & commit**

`npm run typecheck`. Then:

```
git add src/sanity/lib/queries.ts
git commit -m "feat: member queries use status; add per-drop charge queries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Mutations — club member + charge writes

**Files:** Modify `src/sanity/lib/mutations.ts`

- [ ] **Step 1: Replace `upsertMember`**

`upsertMember` was subscription-shaped. Replace the `MemberSyncInput` type and the `upsertMember` function with:

```ts
type CreateMemberInput = {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  customerEmail: string;
};

/**
 * Create a Bread Club member on a completed join (idempotent — `_id` is the
 * Stripe customer id, so a webhook redelivery is a no-op). The `founding` tag
 * is assigned once, at creation, while fewer than `foundingSeats` exist.
 */
export async function createClubMember(input: CreateMemberInput): Promise<boolean> {
  if (!writeClient) return false;
  const docId = input.stripeCustomerId;
  const email = input.customerEmail.trim().toLowerCase();
  const now = new Date().toISOString();

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
    stripePaymentMethodId: input.stripePaymentMethodId,
    status: "active",
    joinedAt: now,
    ...(founding ? { founding: true } : {}),
  });
  // A returning (previously canceled) member rejoining: reactivate + refresh
  // the saved card. New members: this patch is a harmless no-op over the create.
  await writeClient
    .patch(docId)
    .set({
      status: "active",
      stripePaymentMethodId: input.stripePaymentMethodId,
      customerEmail: email,
    })
    .unset(["canceledAt"])
    .commit();
  return true;
}

/** Update a member's saved card (card-update flow). */
export async function setMemberCard(
  stripeCustomerId: string,
  stripePaymentMethodId: string,
): Promise<boolean> {
  if (!writeClient) return false;
  await writeClient
    .patch(stripeCustomerId)
    .set({ stripePaymentMethodId })
    .commit();
  return true;
}

/** Cancel a membership (self-cancel or baker removal). */
export async function cancelMember(stripeCustomerId: string): Promise<boolean> {
  if (!writeClient) return false;
  await writeClient
    .patch(stripeCustomerId)
    .set({ status: "canceled", canceledAt: new Date().toISOString() })
    .commit();
  return true;
}
```

Add `import { site } from "@/lib/site";` to the top of `mutations.ts` if not already imported.

- [ ] **Step 2: Add `recordMemberCharge`**

Append to `mutations.ts`:

```ts
type MemberChargeInput = {
  dropId: string;
  stripeCustomerId: string;
  customerEmail: string;
  amountCents: number;
  status: "paid" | "failed";
  stripePaymentIntentId?: string;
  failureMessage?: string;
};

/**
 * Write (or replace) the memberCharge record for a (drop, member). The
 * deterministic `_id` makes a re-run overwrite the prior attempt rather than
 * duplicating it.
 */
export async function recordMemberCharge(input: MemberChargeInput): Promise<void> {
  if (!writeClient) return;
  await writeClient.createOrReplace({
    _id: `charge.${input.dropId}.${input.stripeCustomerId}`,
    _type: "memberCharge",
    member: { _type: "reference", _ref: input.stripeCustomerId },
    drop: { _type: "reference", _ref: input.dropId },
    customerEmail: input.customerEmail,
    amountCents: input.amountCents,
    status: input.status,
    ...(input.stripePaymentIntentId
      ? { stripePaymentIntentId: input.stripePaymentIntentId }
      : {}),
    ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
    chargedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 3: Update `upsertMemberSelection`**

`upsertMemberSelection` currently takes/writes `shipInvoiceItemId`. Replace its input type and body so it no longer touches `shipInvoiceItemId` and instead carries `skipped`:

```ts
type MemberSelectionInput = {
  dropId: string;
  email: string;
  /** Omitted/undefined when the member is skipping this drop. */
  productSlug?: string;
  fulfillment: "pickup" | "ship";
  skipped: boolean;
};

export async function upsertMemberSelection(
  input: MemberSelectionInput,
): Promise<boolean> {
  if (!writeClient) return false;
  const email = input.email.trim().toLowerCase();
  const existing = await writeClient.fetch<{ _id: string } | null>(
    `*[_type == "memberSelection" && drop._ref == $dropId && customerEmail == $email][0]{ _id }`,
    { dropId: input.dropId, email },
  );
  const now = new Date().toISOString();
  const fields = {
    fulfillment: input.fulfillment,
    skipped: input.skipped,
    selectedAt: now,
    ...(input.productSlug ? { productSlug: input.productSlug } : {}),
  };
  if (existing) {
    let patch = writeClient.patch(existing._id).set(fields);
    if (input.skipped || !input.productSlug) patch = patch.unset(["productSlug"]);
    await patch.commit();
  } else {
    await writeClient.create({
      _type: "memberSelection",
      drop: { _type: "reference", _ref: input.dropId },
      customerEmail: email,
      ...fields,
    });
  }
  return true;
}
```

- [ ] **Step 4: Verify & commit**

`npm run typecheck` (suite not green until catalog/routes are updated — Phase 1 ends green after Task 8). Then:

```
git add src/sanity/lib/mutations.ts
git commit -m "feat: club member + memberCharge mutations; selection skip support

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Catalog — skip-aware selections + member/charge fetches

**Files:** Modify `src/lib/catalog.ts`

- [ ] **Step 1: Update the member types & `getMemberByEmail`**

In `src/lib/catalog.ts`:
- `ActiveMember` type: replace `subscriptionStatus: string;` with `stripePaymentMethodId?: string;` and `founding: boolean;`.
- `MemberRecord` type: replace `subscriptionStatus: string;` with `status: string;`.
- These match the updated `ACTIVE_MEMBERS_QUERY` / `MEMBER_BY_EMAIL_QUERY` from Task 6. `getActiveMembers`, `getActiveMemberCount`, `getMemberByEmail`, `getFoundingMemberCount` keep their bodies.

- [ ] **Step 2: Make `getMemberSelectionsForDrop` skip-aware**

In `getMemberSelectionsForDrop`, a member who `skipped` must NOT claim a loaf or get a default. After the `explicit` selections are fetched, filter out skipped ones for the loaf-claiming view, and exclude skipped members from default materialization:

- Where `explicit` is built from `fromSanity`, change it to drop skipped rows:
  ```ts
  const explicit = (fromSanity ?? [])
    .filter((s) => !(s as { skipped?: boolean }).skipped)
    .map((s) => ({ ...s, source: "explicit" as const }));
  ```
- Where the default loaf is materialized for members without an explicit pick: also exclude members who have a `skipped` selection. Build a `skippedEmails` set from the raw `fromSanity` and add `!skippedEmails.has(m.customerEmail)` to the `.filter(...)` that produces `defaults`:
  ```ts
  const skippedEmails = new Set(
    (fromSanity ?? [])
      .filter((s) => (s as { skipped?: boolean }).skipped)
      .map((s) => s.customerEmail),
  );
  // ...in the defaults filter:
  .filter((m) => !explicitEmails.has(m.customerEmail) && !skippedEmails.has(m.customerEmail))
  ```

- [ ] **Step 3: Add `getMemberChargesForDrop`**

Add the `MEMBER_CHARGES_FOR_DROP_QUERY` import and a fetch function:

```ts
export type MemberChargeRow = {
  id: string;
  customerId: string;
  customerEmail: string;
  status: "paid" | "failed";
  amountCents: number;
  failureMessage?: string;
};

/** All memberCharge rows for a drop. `[]` in demo mode or on failure. */
export async function getMemberChargesForDrop(
  dropId: string,
  opts: FetchOpts = {},
): Promise<MemberChargeRow[]> {
  if (!sanityClient || !dropId) return [];
  try {
    const rows = await fetchSanity<MemberChargeRow[]>(
      MEMBER_CHARGES_FOR_DROP_QUERY,
      { dropId },
      opts,
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("[catalog] member charges fetch failed", err);
    return [];
  }
}
```

Add `MEMBER_CHARGES_FOR_DROP_QUERY` to the `@/sanity/lib/queries` import block.

- [ ] **Step 4: Verify & commit**

`npm run typecheck` → **PASS** (Phase 1 complete — schemas/queries/mutations/catalog now consistent). `npm run lint` → PASS. `npm test` → PASS (incl. the 2 new pure suites).

```
git add src/lib/catalog.ts
git commit -m "feat: skip-aware member selections + member-charge fetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 2 — Join flow

### Task 9: Rewrite `/api/bread-club` to `setup`-mode checkout

**Files:** Modify `src/app/api/bread-club/route.ts`

- [ ] **Step 1: Replace the route**

Replace the entire contents of `src/app/api/bread-club/route.ts` with:

```ts
import { getActiveMemberCount, getMemberByEmail } from "@/lib/catalog";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Starts a Bread Club join — a Stripe `setup`-mode Checkout that saves a card
 * on file (charges nothing). The webhook creates the member on completion.
 * Per-drop $10 charges happen later, when the baker runs a drop.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return Response.json(
      { error: "Bread Club isn't open for sign-ups online yet." },
      { status: 503 },
    );
  }

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    body = {};
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return Response.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  // Dedup: an ACTIVE member with this email already exists → don't re-join.
  // (A previously canceled member with this email may rejoin.)
  const existing = await getMemberByEmail(email, { fresh: true });
  if (existing && existing.status === "active") {
    return Response.json({
      alreadyMember: true,
      message:
        "You're already a Bread Club member with that email. Use the manage link in any of our emails to update your card or leave the club.",
    });
  }

  // Server-side seat cap.
  const memberCount = await getActiveMemberCount({ fresh: true });
  if (memberCount !== null && memberCount >= site.breadClub.seats) {
    return Response.json(
      {
        error: `The Bread Club is full (${site.breadClub.seats} members). Email ${site.email} to join the waitlist.`,
      },
      { status: 409 },
    );
  }

  const base = siteUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer_email: email,
      payment_method_types: ["card"],
      metadata: { kind: "club-join" },
      custom_text: {
        submit: {
          message: `Save your card for ${site.name}'s Bread Club. You're charged $10 only on weeks we bake — skip any drop you don't want.`,
        },
      },
      success_url: `${base}/order/success?session_id={CHECKOUT_SESSION_ID}&club=1`,
      cancel_url: `${base}/bread-club`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[bread-club] Stripe error:", err);
    return Response.json(
      { error: "Could not start sign-up. Please try again." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify**

`npm run typecheck` — if the Stripe SDK rejects `mode: "setup"` with `customer_email` + `currency`, STOP and report NEEDS_CONTEXT with the exact error (do not guess). The expected shape per Stripe API: `mode: "setup"` accepts `customer_email`, `payment_method_types`, `metadata`, `custom_text`, `currency`. `npm run lint` → PASS.

- [ ] **Step 3: Commit**

```
git add src/app/api/bread-club/route.ts
git commit -m "feat: Bread Club join saves a card (setup-mode checkout)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Webhook — handle `setup` completion, drop subscription handling

**Files:** Modify `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Update imports**

Change the `@/sanity/lib/mutations` import to drop `upsertMember` and add the club functions:

```ts
import {
  createClubMember,
  createOrder,
  decrementDropQuantities,
  redeemPromo,
  setMemberCard,
} from "@/sanity/lib/mutations";
```

- [ ] **Step 2: Rewrite the event switch**

Replace the `if (event.type === "checkout.session.completed") { ... } else if (...subscription...) { ... }` block in `POST` with:

```ts
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "setup") {
      await handleSetupCompleted(stripe, session);
    } else {
      await handleCompletedCheckout(stripe, session);
    }
  }
```

- [ ] **Step 3: Delete `handleSubscriptionEvent`**

Delete the entire `handleSubscriptionEvent` function from the file (it is no longer referenced).

- [ ] **Step 4: Add `handleSetupCompleted`**

Add this function to the file (e.g. after `handleCompletedCheckout`):

```ts
/**
 * A completed `setup`-mode Checkout — a Bread Club join or a card update.
 * Saves the entered card as the customer's default and writes/updates the
 * member doc. `metadata.kind` distinguishes the two.
 */
async function handleSetupCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const kind = session.metadata?.kind;
  if (kind !== "club-join" && kind !== "club-card-update") return;

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id;
  if (!customerId || !setupIntentId) {
    console.error("[webhook] setup session missing customer/setup_intent", session.id);
    return;
  }

  let paymentMethodId: string | null = null;
  try {
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    paymentMethodId =
      typeof si.payment_method === "string"
        ? si.payment_method
        : (si.payment_method?.id ?? null);
  } catch (err) {
    console.error("[webhook] setup intent retrieve failed", session.id, err);
    return;
  }
  if (!paymentMethodId) {
    console.error("[webhook] setup session has no payment method", session.id);
    return;
  }

  // Make it the customer's default so off-session charges resolve cleanly.
  try {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  } catch (err) {
    console.error("[webhook] could not set default payment method", customerId, err);
  }

  if (kind === "club-card-update") {
    await setMemberCard(customerId, paymentMethodId);
    console.info(`[webhook] member ${customerId} card updated`);
    return;
  }

  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) {
    console.error("[webhook] club-join session has no email", session.id);
    return;
  }
  await createClubMember({
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethodId,
    customerEmail: email,
  });
  console.info(`[webhook] Bread Club member created ${customerId} <${email}>`);
}
```

- [ ] **Step 5: Verify & commit**

`npm run typecheck` → PASS. `npm run lint` → PASS. `npm test` → PASS.

```
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: webhook handles club join/card-update; drops subscription events

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 3 — Per-drop charge

### Task 11: The charge route

**Files:** Create `src/app/api/admin/club/charge/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/club/charge/route.ts`:

```ts
import type Stripe from "stripe";

import { getAdminSession } from "@/lib/admin-auth";
import {
  getActiveMembers,
  getMemberChargesForDrop,
} from "@/lib/catalog";
import { sanityClient } from "@/sanity/client";
import { MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY } from "@/sanity/lib/queries";
import { recordMemberCharge } from "@/sanity/lib/mutations";
import { dropChargeCents, shouldChargeMember } from "@/lib/club-billing";
import { sendClubDeclineEmail } from "@/lib/club-emails";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

type SelectionRow = { customerEmail: string; fulfillment: "pickup" | "ship"; skipped: boolean };

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe || !sanityClient) {
    return Response.json({ error: "Stripe/Sanity not configured." }, { status: 503 });
  }

  let body: { dropId?: unknown };
  try {
    body = (await req.json()) as { dropId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const dropId = typeof body.dropId === "string" ? body.dropId.trim() : "";
  if (!dropId) return Response.json({ error: "Missing dropId." }, { status: 400 });

  const fresh = sanityClient.withConfig({ useCdn: false });
  const [members, selections, charges] = await Promise.all([
    getActiveMembers({ fresh: true }),
    fresh.fetch<SelectionRow[]>(
      MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY,
      { dropId },
      { cache: "no-store" as const },
    ),
    getMemberChargesForDrop(dropId, { fresh: true }),
  ]);

  const selectionByEmail = new Map(
    (selections ?? []).map((s) => [s.customerEmail.toLowerCase(), s]),
  );
  const chargeStatusByCustomer = new Map(
    charges.map((c) => [c.customerId, c.status]),
  );

  let paid = 0;
  let failed = 0;
  let skipped = 0;
  const failures: { email: string; reason: string }[] = [];

  for (const member of members) {
    const selection = selectionByEmail.get(member.customerEmail.toLowerCase()) ?? null;
    const prior = chargeStatusByCustomer.get(member.stripeCustomerId) ?? null;
    if (!shouldChargeMember(selection, prior)) {
      if (selection?.skipped) skipped += 1;
      continue;
    }
    if (!member.stripePaymentMethodId) {
      failed += 1;
      failures.push({ email: member.customerEmail, reason: "No saved card" });
      await recordMemberCharge({
        dropId,
        stripeCustomerId: member.stripeCustomerId,
        customerEmail: member.customerEmail,
        amountCents: dropChargeCents(selection?.fulfillment ?? "pickup"),
        status: "failed",
        failureMessage: "No saved card on file",
      });
      continue;
    }
    const amountCents = dropChargeCents(selection?.fulfillment ?? "pickup");
    try {
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: member.stripeCustomerId,
        payment_method: member.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Bread Club drop`,
        metadata: { dropId, customerEmail: member.customerEmail, kind: "club-drop" },
      });
      await recordMemberCharge({
        dropId,
        stripeCustomerId: member.stripeCustomerId,
        customerEmail: member.customerEmail,
        amountCents,
        status: "paid",
        stripePaymentIntentId: intent.id,
      });
      paid += 1;
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "Card charge failed";
      const intentId =
        err && typeof err === "object" && "raw" in err
          ? ((err as { raw?: { payment_intent?: { id?: string } } }).raw
              ?.payment_intent?.id ?? undefined)
          : undefined;
      await recordMemberCharge({
        dropId,
        stripeCustomerId: member.stripeCustomerId,
        customerEmail: member.customerEmail,
        amountCents,
        status: "failed",
        stripePaymentIntentId: intentId,
        failureMessage: reason,
      });
      failed += 1;
      failures.push({ email: member.customerEmail, reason });
      await sendClubDeclineEmail({
        to: member.customerEmail,
        stripeCustomerId: member.stripeCustomerId,
      });
    }
  }

  return Response.json({ ok: true, paid, failed, skipped, failures });
}
```

- [ ] **Step 2: Verify**

`npm run typecheck` — expect FAIL until Task 17 creates `src/lib/club-emails.ts` (`sendClubDeclineEmail`). Confirm `getAdminSession` is exported from `@/lib/admin-auth` (used by `src/app/api/reservations/decide/route.ts` — it is). The suite goes green after Task 17. `npm run lint` for this file's own issues.

- [ ] **Step 3: Commit**

```
git add src/app/api/admin/club/charge/route.ts
git commit -m "feat: per-drop member charge route (off-session, idempotent)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Admin "Charge members" button

**Files:** Create `src/components/club-charge-button.tsx`; Modify `src/app/admin/club/[dropId]/page.tsx`

- [ ] **Step 1: Create the client button**

Create `src/components/club-charge-button.tsx`:

```tsx
"use client";

import { useState } from "react";

type ChargeResult = {
  ok?: boolean;
  paid?: number;
  failed?: number;
  skipped?: number;
  failures?: { email: string; reason: string }[];
  error?: string;
};

export function ClubChargeButton({ dropId }: { dropId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChargeResult | null>(null);

  async function charge() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/club/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropId }),
      });
      setResult((await res.json()) as ChargeResult);
    } catch {
      setResult({ error: "Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={charge}
        disabled={busy}
        className="btn-acid text-sm"
      >
        {busy ? "Charging…" : "Charge members for this drop ＋"}
      </button>
      {result?.error ? (
        <p className="rounded-2xl panel-mono px-3 py-2 text-sm">{result.error}</p>
      ) : null}
      {result?.ok ? (
        <div className="rounded-2xl nb-card-sm p-3 text-sm">
          <p className="font-bold">
            {result.paid} charged · {result.failed} failed · {result.skipped} skipped
          </p>
          {result.failures && result.failures.length > 0 ? (
            <ul className="mt-1 text-ink-700">
              {result.failures.map((f) => (
                <li key={f.email}>
                  {f.email} — {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-ink-500">
            Safe to click again — paid members are skipped; failures retried.
          </p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Place it in the admin drop view**

In `src/app/admin/club/[dropId]/page.tsx`: import `ClubChargeButton` from `@/components/club-charge-button`, and render `<ClubChargeButton dropId={drop.id} />` inside the Members section (near the `<h2>Members (…)</h2>` heading). Use the page's existing `drop` object for the id.

- [ ] **Step 3: Verify**

`npm run typecheck` (still failing on `club-emails` until Task 17). `npm run lint`. Manual: deferred to Task 17's manual step (full flow).

- [ ] **Step 4: Commit**

```
git add src/components/club-charge-button.tsx "src/app/admin/club/[dropId]/page.tsx"
git commit -m "feat: admin Charge-members button + result summary

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 4 — Skip

### Task 13: Rewrite `/api/club/select` — drop invoice items, add skip

**Files:** Modify `src/app/api/club/select/route.ts`

- [ ] **Step 1: Replace the route**

Replace the entire contents of `src/app/api/club/select/route.ts` with:

```ts
import "server-only";

import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { buildClubConfirmation } from "@/lib/club-confirmation-email";
import { signClubToken, verifyClubToken } from "@/lib/club-token";
import { effectiveDropStatus } from "@/lib/drop-status";
import { sendEmail } from "@/lib/email";
import { site } from "@/lib/site";
import { siteUrl } from "@/lib/url";
import { upsertMemberSelection } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

type Body = {
  dropId?: unknown;
  email?: unknown;
  token?: unknown;
  productSlug?: unknown;
  fulfillment?: unknown;
  skip?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON body." }, { status: 400 });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const token = typeof body.token === "string" ? body.token : "";
  const productSlug = typeof body.productSlug === "string" ? body.productSlug : "";
  const fulfillment = body.fulfillment === "ship" ? "ship" : "pickup";
  const skip = body.skip === true;

  if (!dropId || !email || !token) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!skip && !productSlug) {
    return Response.json({ error: "Pick a loaf or skip this drop." }, { status: 400 });
  }
  if (!verifyClubToken(email, dropId, token)) {
    return Response.json({ error: "Invalid or expired link." }, { status: 403 });
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id !== dropId) {
    return Response.json(
      { error: "This drop is no longer the active one." },
      { status: 409 },
    );
  }
  if (effectiveDropStatus(drop, new Date()) !== "announced") {
    return Response.json(
      { error: "The member selection window for this drop is closed." },
      { status: 409 },
    );
  }

  if (!skip) {
    const line = drop.lineItems.find((li) => li.product.slug === productSlug);
    if (!line) {
      return Response.json(
        { error: "That loaf isn't part of this drop." },
        { status: 409 },
      );
    }
    const selections = await getMemberSelectionsForDrop(drop, { fresh: true });
    const claimedByOthers = selections.filter(
      (s) => s.productSlug === productSlug && s.customerEmail !== email,
    ).length;
    const totalForSlug = Math.max(0, Math.floor(line.quantity ?? 0));
    if (claimedByOthers >= totalForSlug) {
      return Response.json(
        { error: "Another member just claimed the last one — please pick another flavor." },
        { status: 409 },
      );
    }
  }

  const wrote = await upsertMemberSelection({
    dropId,
    email,
    productSlug: skip ? undefined : productSlug,
    fulfillment,
    skipped: skip,
  });
  if (!wrote) {
    return Response.json(
      { error: "Selections can't be saved — Sanity write client isn't configured." },
      { status: 503 },
    );
  }

  // Confirmation email — for a pick, confirm the loaf; for a skip, confirm
  // the skip. Best-effort: log + swallow so a flaky mailer never blocks save.
  const freshToken = signClubToken(email, drop.id);
  const selfServeUrl = `${siteUrl()}/club/${drop.id}?email=${encodeURIComponent(email)}&token=${freshToken}`;
  const flavorName = skip
    ? null
    : (drop.lineItems.find((li) => li.product.slug === productSlug)?.product.name ?? productSlug);
  const message = buildClubConfirmation({
    skipped: skip,
    flavorName,
    fulfillment,
    dropTitle: drop.title,
    pickupOrShipDate: drop.pickupOrShipDate,
    selfServeUrl,
  });
  const emailSent = await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  return Response.json({ ok: true, skipped: skip, productSlug: skip ? null : productSlug, fulfillment, emailSent });
}
```

- [ ] **Step 2: Adapt `buildClubConfirmation`**

`buildClubConfirmation` (`src/lib/club-confirmation-email.ts`) previously took a `shipSurchargeLabel`. Update its input type and body: remove `shipSurchargeLabel`; add `skipped: boolean` and make `flavorName: string | null`. When `skipped`, the email says the member skipped this drop (no loaf, no charge); otherwise it confirms the loaf + fulfillment as before. Keep using the existing `email-layout` helpers. (Read the current file to apply this — it is a small content/branching change, no new dependencies.)

- [ ] **Step 3: Verify**

`npm run typecheck` — note `buildClubConfirmation`'s call site and definition must agree (Step 1 + Step 2 together). `npm run lint`. The ship-surcharge invoice-item logic is fully gone — the surcharge is now applied at charge time (`dropChargeCents`).

- [ ] **Step 4: Commit**

```
git add src/app/api/club/select/route.ts src/lib/club-confirmation-email.ts
git commit -m "feat: club selection supports skip; remove subscription ship-item logic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: "Skip this drop" in the selection form

**Files:** Modify `src/app/club/[dropId]/selection-form.tsx`

- [ ] **Step 1: Add the skip action**

Read `src/app/club/[dropId]/selection-form.tsx`. It posts the member's loaf pick to `/api/club/select`. Add a **"Skip this drop"** button alongside the existing submit:
- It POSTs the same body shape with `skip: true` (and the existing `dropId`, `email`, `token`); `productSlug`/`fulfillment` can be omitted or sent as-is — the route ignores them when `skip` is true.
- On success, show the form's existing success/confirmation state, worded for a skip ("You've skipped this drop — you won't be charged. Changed your mind? Pick a loaf above while the window is open.").
- Keep the existing pick-a-loaf submit. A member can switch between picking and skipping while the window is open (each POST upserts the one `memberSelection`).

Match the file's existing state/handler patterns; do not restructure the component.

- [ ] **Step 2: Verify**

`npm run typecheck` → PASS. `npm run lint` → PASS. `npm test` → PASS.
Manual: `npm run dev`, open a member selection link for an announced drop, confirm "Skip this drop" saves and the confirmation reflects a skip; confirm picking a loaf afterward still works.

- [ ] **Step 3: Commit**

```
git add "src/app/club/[dropId]/selection-form.tsx"
git commit -m "feat: members can skip a drop from the selection form

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 5 — Card update, cancel, decline email, removal

### Task 15: Decline email

**Files:** Create `src/lib/club-emails.ts`

- [ ] **Step 1: Create the module**

Create `src/lib/club-emails.ts`:

```ts
import "server-only";

import { signClubMemberToken } from "./club-token";
import { sendEmail } from "./email";
import { emailButton, infoCard, renderEmail } from "./email-layout";
import { site } from "./site";
import { siteUrl } from "./url";

/**
 * Customer email sent when an off-session per-drop charge declines — nudges
 * them to update their card. Best-effort: logs + swallows its own errors.
 */
export async function sendClubDeclineEmail(input: {
  to: string;
  stripeCustomerId: string;
}): Promise<void> {
  const token = signClubMemberToken(input.stripeCustomerId);
  const updateUrl = `${siteUrl()}/api/club/update-card?customer=${encodeURIComponent(
    input.stripeCustomerId,
  )}&token=${token}`;
  const text = [
    `Hi — your card was declined for this week's ${site.name} Bread Club drop.`,
    "",
    `Update your card to stay in the club: ${updateUrl}`,
    "",
    "Once it's updated we'll re-run the charge. No loaf is held until payment goes through.",
  ].join("\n");
  const html = renderEmail({
    preheader: `Update your ${site.name} Bread Club card`,
    eyebrow: "Card declined",
    heading: "Your Bread Club card needs an update",
    bodyHtml:
      infoCard(
        "Your card was declined for this week's drop. Update it and we'll re-run the charge.",
      ) +
      `<p style="margin:18px 0 0;">` +
      emailButton(updateUrl, "Update my card", "primary") +
      `</p>`,
  });
  try {
    await sendEmail({
      to: input.to,
      subject: `${site.name} — your Bread Club card was declined`,
      html,
      text,
    });
  } catch (err) {
    console.error("[club-emails] decline send failed", err);
  }
}
```

- [ ] **Step 2: Verify & commit**

`npm run typecheck` → **PASS** (this completes Task 11/12's dependency — `sendClubDeclineEmail` now exists; the charge route + admin button compile). `npm run lint` → PASS. `npm test` → PASS.

```
git add src/lib/club-emails.ts
git commit -m "feat: Bread Club card-declined email

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Cancel route

**Files:** Create `src/app/api/club/cancel/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/club/cancel/route.ts`:

```ts
import { cancelMember } from "@/sanity/lib/mutations";
import { verifyClubMemberToken } from "@/lib/club-token";

export const runtime = "nodejs";

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customer = url.searchParams.get("customer") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!customer || !verifyClubMemberToken(customer, token)) {
    return page("Invalid link", "This Bread Club link is invalid.");
  }
  await cancelMember(customer);
  return page(
    "You've left the Bread Club",
    "Your membership is canceled and your card will not be charged again. Thanks for baking with us — you're welcome back anytime.",
  );
}
```

- [ ] **Step 2: Verify & commit**

`npm run typecheck` → PASS. `npm run lint` → PASS.

```
git add src/app/api/club/cancel/route.ts
git commit -m "feat: self-serve Bread Club cancel (magic link)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Card-update route

**Files:** Create `src/app/api/club/update-card/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/club/update-card/route.ts`:

```ts
import { verifyClubMemberToken } from "@/lib/club-token";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

function errorPage(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Bread Club</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">Link problem</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customer = url.searchParams.get("customer") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!customer || !verifyClubMemberToken(customer, token)) {
    return errorPage("This card-update link is invalid.");
  }
  const stripe = getStripe();
  if (!stripe) return errorPage("Card updates aren't available right now.");

  const base = siteUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer,
      payment_method_types: ["card"],
      metadata: { kind: "club-card-update" },
      success_url: `${base}/order/success?session_id={CHECKOUT_SESSION_ID}&club=1`,
      cancel_url: `${base}/bread-club`,
    });
    if (!session.url) return errorPage("Could not start the card update.");
    return Response.redirect(session.url, 303);
  } catch (err) {
    console.error("[club/update-card] Stripe error:", err);
    return errorPage("Could not start the card update — please try again.");
  }
}
```

- [ ] **Step 2: Verify & commit**

`npm run typecheck` → PASS. `npm run lint` → PASS. (The webhook's `handleSetupCompleted` already handles `kind: "club-card-update"` from Task 10.)

```
git add src/app/api/club/update-card/route.ts
git commit -m "feat: Bread Club card-update magic link (setup checkout)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Admin "Remove from club"

**Files:** Create `src/app/api/admin/club/remove/route.ts`; Create `src/components/club-member-row-actions.tsx`; Modify `src/app/admin/club/[dropId]/page.tsx`

- [ ] **Step 1: Create the remove route**

Create `src/app/api/admin/club/remove/route.ts`:

```ts
import { getAdminSession } from "@/lib/admin-auth";
import { cancelMember } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { customerId?: unknown };
  try {
    body = (await req.json()) as { customerId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  if (!customerId) return Response.json({ error: "Missing customerId." }, { status: 400 });
  await cancelMember(customerId);
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Create the client remove button**

Create `src/components/club-member-row-actions.tsx`:

```tsx
"use client";

import { useState } from "react";

export function ClubMemberRemove({
  customerId,
  email,
}: {
  customerId: string;
  email: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function remove() {
    if (!window.confirm(`Remove ${email} from the Bread Club? Their card won't be charged again.`)) {
      return;
    }
    setState("busy");
    try {
      const res = await fetch("/api/admin/club/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") return <span className="text-xs text-ink-500">Removed</span>;
  return (
    <button
      type="button"
      onClick={remove}
      disabled={state === "busy"}
      className="text-xs font-semibold uppercase text-acid-600 underline decoration-2 hover:no-underline"
    >
      {state === "busy" ? "Removing…" : state === "error" ? "Retry remove" : "Remove from club"}
    </button>
  );
}
```

- [ ] **Step 3: Place it in the admin members list**

In `src/app/admin/club/[dropId]/page.tsx`, in the Members list row rendering, add `<ClubMemberRemove customerId={...} email={...} />` per member. The member rows are built from member-selection data; the member's `stripeCustomerId` is needed — if the admin page's member rows don't already carry it, extend the page's member fetch/`enriched` rows to include `stripeCustomerId` from `getActiveMembers()` (joined by email). Import `ClubMemberRemove` from `@/components/club-member-row-actions`.

- [ ] **Step 4: Verify & commit**

`npm run typecheck` → PASS. `npm run lint` → PASS.

```
git add src/app/api/admin/club/remove/route.ts src/components/club-member-row-actions.tsx "src/app/admin/club/[dropId]/page.tsx"
git commit -m "feat: admin Remove-from-club action

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 6 — Config, copy, cleanup

### Task 19: Config + `/bread-club` copy

**Files:** Modify `src/lib/site.ts`; Modify `src/app/bread-club/page.tsx`

- [ ] **Step 1: Update `site.breadClub`**

In `src/lib/site.ts`, in the `breadClub` object: set `priceLabel: "$10"`, `cadenceLabel: "per drop"`. **Remove** `perLoafLabel` and `loavesPerCycle`. Keep `seats: 12`, `foundingSeats: 5`, `defaultLoafSlug`, `shipSurchargeCents: 1200`. Update the block's doc comment to describe per-drop billing (no recurring Stripe Price).

- [ ] **Step 2: Update `/bread-club` copy**

In `src/app/bread-club/page.tsx`:
- The `enabled` gate currently uses `process.env.STRIPE_BREAD_CLUB_PRICE_ID`. Change `enabled` to be driven by whether Stripe sign-ups are available — since the page is a server component, gate on a server-readable signal: `const enabled = Boolean(process.env.STRIPE_SECRET_KEY);`.
- Price display: render "$10 per drop" (the membership/founding hero is unaffected). Replace any `perLoafLabel` / `loavesPerCycle` references in the copy.
- Perks list: replace the "One Classic loaf per drop (N per billing cycle)" entry with "One loaf per drop — $10, charged only on weeks we bake." Replace the "Pause, skip a week…" entry with "Skip any drop you don't want — just tell us in your loaf-pick email, and that week is free." Remove mentions of Stripe-managed pause/cancel; cancellation is the self-serve link.
- The "Ready when you are" card copy: describe "$10 per drop, billed when the drop runs" instead of "$40 / 4 weeks".

Read the current file to apply these precisely; keep the just-shipped membership/founding hero intact.

- [ ] **Step 3: Verify & commit**

`npm run typecheck` → PASS. `npm run lint` → PASS. Manual: `/bread-club` shows "$10 per drop" and the hero still shows the live counts.

```
git add src/lib/site.ts src/app/bread-club/page.tsx
git commit -m "feat: Bread Club copy/config — $10 per drop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Cleanup pass

**Files:** repo-wide check

- [ ] **Step 1: Remove dead subscription references**

Grep the repo for `STRIPE_BREAD_CLUB_PRICE_ID`, `subscriptionStatus`, `stripeSubscriptionId`, `handleSubscriptionEvent`, `upsertMember`, `loavesPerCycle`, `perLoafLabel`, `shipInvoiceItemId`:

Run: `git grep -n -E "STRIPE_BREAD_CLUB_PRICE_ID|subscriptionStatus|stripeSubscriptionId|handleSubscriptionEvent|upsertMember|loavesPerCycle|perLoafLabel|shipInvoiceItemId" -- 'src/*'`

Expected: no matches in `src/` (only — acceptably — in `docs/`). Any remaining `src/` hit is dead code or a missed reference from Tasks 1–19 — fix it (remove the dead code / update the reference). Common expected leftovers to clean: a `getMemberByEmail` caller still reading `subscriptionStatus`, or `seed`/admin code referencing removed `site.breadClub` fields.

- [ ] **Step 2: Full verification**

Run: `npm run typecheck` → PASS. `npm run lint` → PASS. `npm test` → PASS (all suites, incl. `club-billing` and `club-token`).

- [ ] **Step 3: Manual end-to-end check**

`npm run dev` with Stripe test keys + the webhook forwarded (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`):
- Join via `/bread-club` → `setup` checkout → a `member` doc appears (`status: active`, card saved).
- On an announced drop, a member picks a loaf or skips via `/club/[dropId]`.
- In admin, "Charge members for this drop" → paid/failed/skipped summary; `memberCharge` docs written; re-clicking only charges the unpaid.
- A declined test card → failed charge + decline email with a working card-update link.
- The cancel magic link → `member.status: canceled`, excluded from the next charge run.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "chore: remove dead Bread Club subscription code

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 data model → Tasks 1–3 (schemas), 6 (queries), 7 (mutations). ✅
- §2 join → Tasks 9 (route), 10 (webhook). ✅
- §3 per-drop charge → Tasks 4 (pure helpers), 11 (route), 12 (admin button). ✅
- §4 skip → Tasks 2 (`skipped` field), 8 (`getMemberSelectionsForDrop`), 13 (select route), 14 (form). ✅
- §5 declined cards → Tasks 11 (failure path), 15 (decline email). ✅
- §6 card update + cancel → Tasks 5 (member token), 16 (cancel), 17 (card-update). ✅
- §7 lifecycle / manual removal → Tasks 7 (`cancelMember`), 18 (admin remove). ✅
- §8 webhook → Task 10. ✅
- §9 config/copy/cleanup → Tasks 19, 20. ✅

**Placeholder scan:** none — every step has complete code or an exact, bounded modification. The three modification-only tasks (13 Step 2 `buildClubConfirmation`, 14 the form, 18 Step 3 / 12 Step 2 the admin page) name the exact file, the exact change, and its shape; the implementer reads the file to apply it (these are large existing files; the change is fully specified, not a "TODO"). ✅

**Cross-task type consistency:** `createClubMember`/`setMemberCard`/`cancelMember`/`recordMemberCharge` (Task 7) match their callers in Tasks 10, 11, 16, 18. `dropChargeCents`/`shouldChargeMember` (Task 4) match the charge route (Task 11). `signClubMemberToken`/`verifyClubMemberToken` (Task 5) match Tasks 15, 16, 17. `MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY` / `MEMBER_CHARGES_FOR_DROP_QUERY` / `getMemberChargesForDrop` (Tasks 6, 8) match Task 11. `upsertMemberSelection`'s new signature (Task 7) matches Task 13. `member` fields (`status`, `stripePaymentMethodId`, `canceledAt`, Task 1) are used consistently in Tasks 6–18. ✅

**Build-order note:** the suite is intentionally red mid-Phase-1 (Tasks 1–7 reshape interlocking schema/query/mutation files) and again from Task 11 until Task 15 (the charge route references `club-emails`, created in Task 15). Each such task's verify step says so explicitly. The suite is green at Task 8 and from Task 15 onward.
