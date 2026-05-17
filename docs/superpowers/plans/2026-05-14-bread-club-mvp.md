# Bread Club Member-Selection MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paying Bread Club member open a signed link, see the loaves in the next announced drop, and pick one. Their pick reserves one loaf out of the public drop inventory.

**Architecture:** A new Sanity document type `memberSelection` records `{ drop, customerEmail, productSlug }` per cycle. The drop's public availability subtracts the number of confirmed selections from each flavor's line quantity. Members reach the picker via a signed magic link (`/club/[dropId]?email=…&token=…`) — token is `HMAC_SHA256(email|dropId, CLUB_LINK_SECRET)`. There is no auth UI, no Stripe portal redirect, no DB beyond Sanity. The selection window opens while the drop status is `announced` and closes the moment the baker flips it to `open` — the existing drop-status state machine enforces this without new code.

**Tech Stack:** Next.js 16 (App Router), Sanity v5 (CMS + auth via existing `SANITY_API_WRITE_TOKEN`), Node's built-in `crypto` for HMAC. No new dependencies.

**Explicit decisions made in this plan (push back if any are wrong):**
1. **Selections are explicit only — no auto-default to Classic Country.** If a member doesn't open their link before the drop opens, the bake list shows them as "no selection" and the baker decides manually. Trade-off: simpler model, no Stripe API call in the hot path; downside: the baker carries the swap-window discipline.
2. **`memberAllocation` is _not_ a field on the drop.** Public availability subtracts only confirmed `memberSelection` docs. This means if all 8 active members are slow to pick, the public could buy through the inventory before they get to it. We mitigate by keeping the drop in `announced` status (no public buying) until the baker flips it to `open` after the selection window closes.
3. **No Stripe webhook for subscription events in MVP.** Active-member enumeration happens in a baker-run script (`scripts/club-emails.mjs`) that lists Stripe subscriptions on demand. Webhook-driven membership cache is a follow-up plan.
4. **No Resend integration in MVP.** The script prints magic links to stdout; the baker pastes them into their email tool. Resend is a follow-up.
5. **Skip-a-week is out of scope.** Baker pauses the subscription in the Stripe dashboard manually.
6. **No test framework exists in this repo.** Each task uses `npm run typecheck` and explicit curl/browser smoke tests for verification. Adding Vitest is a separate, optional plan.

---

## File Structure

- **Create:**
  - `src/sanity/schemaTypes/memberSelection.ts` — new Sanity doc type
  - `src/lib/club-token.ts` — HMAC signing + verification helpers
  - `src/lib/club.ts` — server-only helpers: fetch active drop for club, fetch selections, write a selection
  - `src/app/api/club/select/route.ts` — POST endpoint that records a selection
  - `src/app/club/[dropId]/page.tsx` — the member picker page
  - `src/app/club/[dropId]/selection-form.tsx` — client-side picker component
  - `scripts/club-emails.mjs` — baker-run script that prints magic links
  - `docs/CLUB.md` — operator runbook for the Bread Club selection flow
- **Modify:**
  - `src/sanity/schemaTypes/index.ts` — register the new type
  - `src/sanity/lib/queries.ts` — add `MEMBER_SELECTIONS_FOR_DROP_QUERY`
  - `src/sanity/lib/mutations.ts` — add `upsertMemberSelection`
  - `src/lib/availability.ts` — `buildAvailability` accepts member selections, subtracts per-flavor counts
  - `src/lib/catalog.ts` — add `getMemberSelectionsForDrop(dropId)` and pass selections into pages that need it
  - `src/app/page.tsx`, `src/app/menu/page.tsx`, `src/app/cart/page.tsx`, `src/app/product/[slug]/page.tsx`, `src/app/api/checkout/route.ts` — all consumers of `buildAvailability` pass selections
  - `.env.example` — document `CLUB_LINK_SECRET`
  - `src/sanity/env.ts` — surface `CLUB_LINK_SECRET` lookup (or read directly from `process.env` in `club-token.ts`, see Task 2)

---

## Task 1: Sanity schema for `memberSelection`

**Files:**
- Create: `src/sanity/schemaTypes/memberSelection.ts`
- Modify: `src/sanity/schemaTypes/index.ts`

- [ ] **Step 1: Create the schema**

```ts
// src/sanity/schemaTypes/memberSelection.ts
import { defineField, defineType } from "sanity";

/**
 * One Bread Club member's choice of loaf for a single drop. Written by the
 * /api/club/select route after verifying the signed magic-link token. The
 * presence of a doc for (drop, email) means "this member has claimed a loaf
 * out of this drop" — its productSlug is which flavor they took.
 */
export const memberSelectionType = defineType({
  name: "memberSelection",
  title: "Member selection",
  type: "document",
  fields: [
    defineField({
      name: "drop",
      title: "Drop",
      type: "reference",
      to: [{ type: "drop" }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "customerEmail",
      title: "Member email",
      type: "string",
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: "productSlug",
      title: "Chosen loaf (slug)",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "selectedAt",
      title: "Selected at",
      type: "datetime",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { email: "customerEmail", slug: "productSlug", at: "selectedAt" },
    prepare: ({ email, slug, at }) => ({
      title: `${email} → ${slug}`,
      subtitle: at ? new Date(at).toLocaleString() : "",
    }),
  },
});
```

- [ ] **Step 2: Register it**

Modify `src/sanity/schemaTypes/index.ts` to import and include the new type:

```ts
import type { SchemaTypeDefinition } from "sanity";

import { categoryType } from "./category";
import { dropType } from "./drop";
import { memberSelectionType } from "./memberSelection";
import { productType } from "./product";

export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  dropType,
  memberSelectionType,
];
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/schemaTypes/memberSelection.ts src/sanity/schemaTypes/index.ts
git commit -m "feat(club): add memberSelection Sanity schema"
```

---

## Task 2: Token signing helpers

**Files:**
- Create: `src/lib/club-token.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `CLUB_LINK_SECRET` to `.env.example`**

Append to `.env.example`:

```
# Used to sign Bread Club magic links. Any long random string; rotate to
# invalidate every outstanding link at once. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CLUB_LINK_SECRET=
```

- [ ] **Step 2: Write the helpers**

```ts
// src/lib/club-token.ts
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs a Bread Club magic link. Token format is a hex HMAC-SHA256 of
 * `${email.toLowerCase()}|${dropId}` keyed by CLUB_LINK_SECRET. Verifying with
 * timingSafeEqual avoids leaking valid-token-prefix information.
 */
function getSecret(): string {
  const secret = process.env.CLUB_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CLUB_LINK_SECRET is not set (or too short) — Bread Club links cannot be signed.",
    );
  }
  return secret;
}

function payload(email: string, dropId: string): string {
  return `${email.trim().toLowerCase()}|${dropId}`;
}

export function signClubToken(email: string, dropId: string): string {
  return createHmac("sha256", getSecret()).update(payload(email, dropId)).digest("hex");
}

export function verifyClubToken(
  email: string,
  dropId: string,
  token: string,
): boolean {
  if (!email || !dropId || !token) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(signClubToken(email, dropId), "hex");
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

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exits 0.

Run an ad-hoc smoke test:
```
node --env-file=.env.local -e "process.env.CLUB_LINK_SECRET='test-secret-at-least-sixteen'; const {signClubToken,verifyClubToken}=require('./src/lib/club-token.ts'); /* TS — skip if it fails, just verify build works */"
```
(If the inline test errors because Node can't import TS directly, that's fine — typecheck is the gate.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/club-token.ts .env.example
git commit -m "feat(club): add HMAC magic-link token helpers"
```

---

## Task 3: Sanity queries & mutations for member selections

**Files:**
- Modify: `src/sanity/lib/queries.ts`
- Modify: `src/sanity/lib/mutations.ts`

- [ ] **Step 1: Add the query**

Append to `src/sanity/lib/queries.ts`:

```ts
export const MEMBER_SELECTIONS_FOR_DROP_QUERY = groq`
  *[_type == "memberSelection" && drop._ref == $dropId]{
    "id": _id,
    customerEmail,
    productSlug,
    selectedAt
  }
`;
```

- [ ] **Step 2: Add the upsert mutation**

Append to `src/sanity/lib/mutations.ts` (after the existing `applyOrderToActiveDrop` function and its supporting code; reuse the same `writeClient` pattern):

```ts
type MemberSelectionInput = {
  dropId: string;
  email: string;
  productSlug: string;
};

/**
 * Records (or replaces) one member's selection for a drop. Idempotent on
 * (drop, email) — calling twice with a different slug swaps the pick. Returns
 * true if the write happened, false if Sanity isn't configured.
 */
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

  if (existing) {
    await writeClient
      .patch(existing._id)
      .set({ productSlug: input.productSlug, selectedAt: now })
      .commit();
  } else {
    await writeClient.create({
      _type: "memberSelection",
      drop: { _type: "reference", _ref: input.dropId },
      customerEmail: email,
      productSlug: input.productSlug,
      selectedAt: now,
    });
  }
  return true;
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/lib/queries.ts src/sanity/lib/mutations.ts
git commit -m "feat(club): query + upsert mutation for memberSelection"
```

---

## Task 4: Member selections in availability

**Files:**
- Modify: `src/lib/availability.ts`
- Modify: `src/lib/catalog.ts`

- [ ] **Step 1: Extend `buildAvailability` to subtract selections**

Replace `src/lib/availability.ts` entirely (the existing exports' shapes are preserved, just `buildAvailability` gains a second parameter):

```ts
import type { Drop } from "./types";

export type Availability = {
  canOrder: boolean;
  remaining: number | null;
  reason?: "soldout" | "not-in-drop" | "not-open";
};

export type MemberSelection = {
  customerEmail: string;
  productSlug: string;
};

const NOT_IN_DROP: Availability = {
  canOrder: false,
  remaining: null,
  reason: "not-in-drop",
};

/**
 * Build a `slug -> Availability` map. Each line item's public quantity is
 * reduced by the number of Bread Club members who have already claimed that
 * flavor for this drop, so public buyers never reserve a loaf that a member
 * is going to walk away with.
 */
export function buildAvailability(
  drop: Drop | null,
  memberSelections: MemberSelection[] = [],
): Map<string, Availability> {
  const map = new Map<string, Availability>();
  if (!drop) return map;
  const open = drop.status === "open";

  const claimedBySlug = new Map<string, number>();
  for (const sel of memberSelections) {
    claimedBySlug.set(sel.productSlug, (claimedBySlug.get(sel.productSlug) ?? 0) + 1);
  }

  for (const { product, quantity } of drop.lineItems) {
    const raw = Math.max(0, Math.floor(quantity ?? 0));
    const claimed = claimedBySlug.get(product.slug) ?? 0;
    const remaining = Math.max(0, raw - claimed);

    let entry: Availability;
    if (!open) {
      entry = {
        canOrder: false,
        remaining,
        reason: drop.status === "announced" ? "not-open" : "soldout",
      };
    } else if (!product.available || remaining <= 0) {
      entry = { canOrder: false, remaining, reason: "soldout" };
    } else {
      entry = { canOrder: true, remaining };
    }
    map.set(product.slug, entry);
  }
  return map;
}

export function availabilityOf(
  map: Map<string, Availability>,
  slug: string,
): Availability {
  return map.get(slug) ?? NOT_IN_DROP;
}

export function unavailableLabel(reason: Availability["reason"]): string {
  switch (reason) {
    case "not-in-drop":
      return "Not in this drop";
    case "not-open":
      return "Coming soon";
    default:
      return "Sold out";
  }
}
```

- [ ] **Step 2: Add `getMemberSelectionsForDrop` to the catalog**

Append to `src/lib/catalog.ts`:

```ts
import type { MemberSelection } from "./availability";
import { MEMBER_SELECTIONS_FOR_DROP_QUERY } from "@/sanity/lib/queries";

export async function getMemberSelectionsForDrop(
  dropId: string | undefined | null,
): Promise<MemberSelection[]> {
  if (!dropId) return [];
  const fromSanity = await fetchSanity<MemberSelection[]>(
    MEMBER_SELECTIONS_FOR_DROP_QUERY,
    { dropId },
  );
  return fromSanity ?? [];
}
```

- [ ] **Step 3: Wire selections through every page that builds availability**

For each of the four pages plus the checkout route, change the call from `buildAvailability(drop)` to `buildAvailability(drop, selections)` where `selections` is awaited alongside the drop. Exact replacements:

`src/app/page.tsx` — change the top of `HomePage`:
```ts
const [drop, products] = await Promise.all([getActiveDrop(), getProducts()]);
const selections = await getMemberSelectionsForDrop(drop?.id);
const availability = buildAvailability(drop, selections);
```
Add the import: `import { getActiveDrop, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";`

`src/app/menu/page.tsx` — same pattern (await drop, then selections, pass both into `buildAvailability`).

`src/app/cart/page.tsx` — same pattern.

`src/app/product/[slug]/page.tsx` — same pattern; just one slug but the helper is per-drop, so pass selections to `buildAvailability`.

`src/app/api/checkout/route.ts` — fetch selections after fetching the drop and pass them in.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exits 0 with no output.

Manual smoke: with the dev server running, load `/`, `/menu`, `/cart` and confirm the existing remaining-loaf counts still display correctly when there are zero member selections (selections array is empty in demo mode because Sanity is disabled, so behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability.ts src/lib/catalog.ts src/app/page.tsx src/app/menu/page.tsx src/app/cart/page.tsx src/app/product/[slug]/page.tsx src/app/api/checkout/route.ts
git commit -m "feat(club): subtract member selections from public availability"
```

---

## Task 5: `/api/club/select` route

**Files:**
- Create: `src/app/api/club/select/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/club/select/route.ts
import "server-only";

import { verifyClubToken } from "@/lib/club-token";
import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { upsertMemberSelection } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

type Body = {
  dropId?: unknown;
  email?: unknown;
  token?: unknown;
  productSlug?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON body." }, { status: 400 });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId : "";
  const email = typeof body.email === "string" ? body.email : "";
  const token = typeof body.token === "string" ? body.token : "";
  const productSlug = typeof body.productSlug === "string" ? body.productSlug : "";

  if (!dropId || !email || !token || !productSlug) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!verifyClubToken(email, dropId, token)) {
    return Response.json({ error: "Invalid or expired link." }, { status: 403 });
  }

  const drop = await getActiveDrop();
  if (!drop || drop.id !== dropId) {
    return Response.json(
      { error: "This drop is no longer the active one." },
      { status: 409 },
    );
  }
  if (drop.status !== "announced") {
    return Response.json(
      { error: "The member selection window for this drop is closed." },
      { status: 409 },
    );
  }
  const line = drop.lineItems.find((li) => li.product.slug === productSlug);
  if (!line) {
    return Response.json(
      { error: "That loaf isn't part of this drop." },
      { status: 409 },
    );
  }

  const selections = await getMemberSelectionsForDrop(drop.id);
  const claimedForSlug = selections.filter(
    (s) => s.productSlug === productSlug && s.customerEmail !== email.toLowerCase(),
  ).length;
  const totalForSlug = Math.max(0, Math.floor(line.quantity ?? 0));
  if (claimedForSlug >= totalForSlug) {
    return Response.json(
      { error: "Another member just claimed the last one — please pick another flavor." },
      { status: 409 },
    );
  }

  const wrote = await upsertMemberSelection({ dropId, email, productSlug });
  if (!wrote) {
    return Response.json(
      { error: "Selections can't be saved — Sanity write client isn't configured." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, productSlug });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/club/select/route.ts
git commit -m "feat(club): POST /api/club/select records member's drop pick"
```

---

## Task 6: `/club/[dropId]` member picker page

**Files:**
- Create: `src/app/club/[dropId]/page.tsx`
- Create: `src/app/club/[dropId]/selection-form.tsx`

- [ ] **Step 1: Server page that verifies the link and loads data**

```tsx
// src/app/club/[dropId]/page.tsx
import { notFound } from "next/navigation";

import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { verifyClubToken } from "@/lib/club-token";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";

import { SelectionForm } from "./selection-form";

export const dynamic = "force-dynamic";

type Search = { email?: string; token?: string };

export default async function ClubDropPage({
  params,
  searchParams,
}: {
  params: Promise<{ dropId: string }>;
  searchParams: Promise<Search>;
}) {
  const { dropId } = await params;
  const { email, token } = await searchParams;

  if (!email || !token || !verifyClubToken(email, dropId, token)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="display text-5xl">Hmm — that link didn&apos;t check out.</h1>
        <p className="mt-4 text-ink-700">
          Try the most recent email from {site.name}. If you think your
          membership should be active, reply to that email and we&apos;ll send a
          fresh link.
        </p>
      </div>
    );
  }

  const drop = await getActiveDrop();
  if (!drop || drop.id !== dropId) notFound();

  const selections = await getMemberSelectionsForDrop(drop.id);
  const myPick = selections.find((s) => s.customerEmail === email.toLowerCase());
  const claimedBySlug = new Map<string, number>();
  for (const s of selections) {
    claimedBySlug.set(s.productSlug, (claimedBySlug.get(s.productSlug) ?? 0) + 1);
  }

  const options = drop.lineItems.map(({ product, quantity }) => {
    const claimedByOthers =
      (claimedBySlug.get(product.slug) ?? 0) -
      (myPick?.productSlug === product.slug ? 1 : 0);
    const remaining = Math.max(0, Math.floor(quantity ?? 0) - claimedByOthers);
    return { product, remaining };
  });

  const windowOpen = drop.status === "announced";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <span className="badge badge-acid">Bread Club · members only</span>
      <h1 className="display mt-3 text-5xl sm:text-6xl">{drop.title}</h1>
      <p className="mt-3 text-ink-700">
        Hi {email} — pick your loaf for this drop. You can change your mind any
        time while the selection window is open.
        {windowOpen
          ? null
          : " (The window has closed for this drop — your pick is locked in.)"}
      </p>

      <SelectionForm
        dropId={drop.id}
        email={email}
        token={token}
        currentSlug={myPick?.productSlug ?? null}
        options={options.map(({ product, remaining }) => ({
          slug: product.slug,
          name: product.name,
          tagline: product.tagline ?? null,
          imageUrl: product.imageUrl ?? null,
          priceLabel: formatPrice(product.priceCents),
          remaining,
        }))}
        windowOpen={windowOpen}
      />

      <div className="mt-10 border-t border-ink/15 pt-4">
        <CottageFoodNotice />
      </div>

      <noscript>
        <p className="mt-4 text-sm text-ink-500">
          JavaScript is required to confirm a selection. Reply to the email and
          we&apos;ll set it for you.
        </p>
      </noscript>
    </div>
  );
}
```

- [ ] **Step 2: Client component for the picker**

```tsx
// src/app/club/[dropId]/selection-form.tsx
"use client";

import { useState } from "react";

import { ProductImage } from "@/components/product-image";

type Option = {
  slug: string;
  name: string;
  tagline: string | null;
  imageUrl: string | null;
  priceLabel: string;
  remaining: number;
};

export function SelectionForm({
  dropId,
  email,
  token,
  currentSlug,
  options,
  windowOpen,
}: {
  dropId: string;
  email: string;
  token: string;
  currentSlug: string | null;
  options: Option[];
  windowOpen: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(currentSlug);
  const [error, setError] = useState<string | null>(null);

  async function pick(slug: string) {
    if (!windowOpen) return;
    setError(null);
    setPending(slug);
    try {
      const res = await fetch("/api/club/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId, email, token, productSlug: slug }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        return;
      }
      setConfirmed(slug);
    } catch {
      setError("Network error — try again in a moment.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      {error ? (
        <p className="nb-card-sm bg-flame/15 p-3 text-sm text-ink">{error}</p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {options.map((opt) => {
          const isMine = confirmed === opt.slug;
          const isPending = pending === opt.slug;
          const soldOut = opt.remaining <= 0 && !isMine;
          const disabled = !windowOpen || soldOut || isPending;
          return (
            <li
              key={opt.slug}
              className={`nb-card overflow-hidden ${isMine ? "ring-2 ring-acid" : ""}`}
            >
              <ProductImage src={opt.imageUrl} alt={opt.name} />
              <div className="space-y-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="display text-xl">{opt.name}</span>
                  <span className="text-sm font-bold">{opt.priceLabel}</span>
                </div>
                {opt.tagline ? (
                  <p className="text-sm text-ink-700">{opt.tagline}</p>
                ) : null}
                <p className="text-xs text-ink-500">
                  {soldOut
                    ? "Claimed by other members"
                    : `${opt.remaining} left for the drop`}
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(opt.slug)}
                  className="btn-acid w-full text-xs"
                >
                  {isMine
                    ? "Your pick ✓"
                    : isPending
                      ? "Saving…"
                      : "Pick this one"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exits 0.

Manual smoke (requires a real Sanity setup with `CLUB_LINK_SECRET` set and a drop in `announced` status with a known `_id`):
1. Generate a token in a quick node REPL:
   ```bash
   node --env-file=.env.local -e "const crypto=require('crypto'); console.log(crypto.createHmac('sha256', process.env.CLUB_LINK_SECRET).update('test@example.com|<DROP_ID>').digest('hex'))"
   ```
2. Visit `http://localhost:3000/club/<DROP_ID>?email=test@example.com&token=<TOKEN>` and confirm the picker renders.
3. Click a flavor; verify the API returns 200 and the page state updates to "Your pick ✓".
4. Reload the page; verify the pick persists.

- [ ] **Step 4: Commit**

```bash
git add src/app/club/[dropId]/page.tsx src/app/club/[dropId]/selection-form.tsx
git commit -m "feat(club): magic-link landing page for member loaf selection"
```

---

## Task 7: `scripts/club-emails.mjs` — list members and print magic links

**Files:**
- Create: `scripts/club-emails.mjs`
- Modify: `package.json` (add `club:emails` script)

- [ ] **Step 1: Write the script**

```js
// scripts/club-emails.mjs
// Lists every active Bread Club subscription in Stripe, generates a signed
// magic link for each member against the given drop id, and prints them to
// stdout for the baker to copy into their email tool.
//
// Usage: npm run club:emails -- <DROP_ID>

import { createHmac } from "node:crypto";

import Stripe from "stripe";

const dropId = process.argv[2];
if (!dropId) {
  console.error("Usage: npm run club:emails -- <DROP_ID>");
  process.exit(1);
}
const stripeKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_BREAD_CLUB_PRICE_ID;
const secret = process.env.CLUB_LINK_SECRET;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
if (!stripeKey || !priceId || !secret) {
  console.error("Missing STRIPE_SECRET_KEY / STRIPE_BREAD_CLUB_PRICE_ID / CLUB_LINK_SECRET");
  process.exit(1);
}

const stripe = new Stripe(stripeKey);

function sign(email) {
  return createHmac("sha256", secret).update(`${email.toLowerCase()}|${dropId}`).digest("hex");
}

const subs = stripe.subscriptions.list({
  price: priceId,
  status: "active",
  expand: ["data.customer"],
  limit: 100,
});

for await (const sub of subs) {
  const customer = sub.customer;
  const email = typeof customer === "object" && customer && "email" in customer ? customer.email : null;
  if (!email) continue;
  const token = sign(email);
  const url = `${siteUrl}/club/${dropId}?email=${encodeURIComponent(email)}&token=${token}`;
  console.log(`${email}\t${url}`);
}
```

(Note: `subs` returned by `stripe.subscriptions.list` is a paginated iterable in the Stripe SDK — `for await` works because Stripe Node SDK responses implement `Symbol.asyncIterator` for auto-pagination. If the version in this repo doesn't, switch to `await stripe.subscriptions.list(...)` and iterate `result.data`.)

- [ ] **Step 2: Add npm script**

In `package.json` scripts:

```json
"club:emails": "node --env-file=.env.local scripts/club-emails.mjs"
```

- [ ] **Step 3: Verify**

Run with a fake-but-valid-format drop id (or a real announced drop's `_id`):
```bash
npm run club:emails -- drop-fake-id
```
Expected: prints one tab-separated line per active member, or nothing if there are no active subscriptions.

- [ ] **Step 4: Commit**

```bash
git add scripts/club-emails.mjs package.json
git commit -m "feat(club): script to print magic links for active members"
```

---

## Task 8: Operator runbook

**Files:**
- Create: `docs/CLUB.md`

- [ ] **Step 1: Write the runbook**

```md
# Bread Club selection runbook

A weekly cadence for getting members their loaf:

1. **Tuesday — publish the drop in Sanity.** Create or update the drop doc. Status: `announced`. Add lineItems for every flavor that will be in this batch. Leave each `quantity` at the *total* you'll bake; the storefront will subtract member picks automatically.
2. **Tuesday — send magic links.** Run `npm run club:emails -- <DROP_ID>`. Copy the printed tab-separated lines into your email tool (Resend / Gmail / etc.) and send each member their link. (When Resend is wired up, this becomes one command.)
3. **Wednesday night — close the selection window.** In Sanity, change the drop's status from `announced` → `open`. Public orders are now open. The /club page is read-only at this point: members who didn't pick are flagged on the bake list.
4. **Friday — bake.** Pull the bake list from Sanity (Studio view: drops + memberSelections, grouped by flavor).
5. **Saturday — pickup.** Sold-out happens when public stock + member picks all clear. Flip status to `closed` once done.

## Failure modes

- **Member missed the window.** Their /club page shows the drop in read-only mode with no pick. The baker emails them to confirm a default (usually Classic Country).
- **Member cancels mid-cycle.** Today: their next link is just never generated by `club:emails`. Their last selection (if any) sticks until the drop closes.
- **Skip-a-week.** Pause the Stripe subscription for that member-week in the dashboard. (Automating this is a future task.)
- **Token leak.** Rotate `CLUB_LINK_SECRET` in `.env.local`; every outstanding link instantly becomes invalid.
```

- [ ] **Step 2: Commit**

```bash
git add docs/CLUB.md
git commit -m "docs(club): selection-flow operator runbook"
```

---

## Task 9: Soft-launch nudge on `/bread-club`

**Files:**
- Modify: `src/app/bread-club/page.tsx`

- [ ] **Step 1: Add a "what to expect" note after a member subscribes**

Inside the existing card on `/bread-club` (the `<div className="nb-card mt-10 …">`), append a small paragraph after the existing `<p>` when `enabled` is true:

```tsx
<p className="mt-2 text-xs text-ink-500">
  After you sign up you&apos;ll get an email before each drop with a personal
  link to pick your loaf. Stripe handles billing, pausing, and cancelling.
</p>
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exits 0.

Manual smoke: visit `/bread-club`, confirm the new line shows beneath the price label only when `STRIPE_BREAD_CLUB_PRICE_ID` is set.

- [ ] **Step 3: Commit**

```bash
git add src/app/bread-club/page.tsx
git commit -m "docs(club): explain the selection email on the public page"
```

---

## Out of scope (follow-up plans)

- `customer.subscription.created/updated/deleted` webhook → membership cache in Sanity.
- Resend integration so `npm run club:emails -- <DROP_ID>` actually sends the emails.
- Automatic skip-a-week handling (pause the subscription one cycle from inside Sanity / Studio button).
- Default-to-Classic-Country for members who don't open the link, gated by an explicit baker "close window" action.
- Stripe Customer Portal link from the /club page so members can pause/cancel without emailing.
