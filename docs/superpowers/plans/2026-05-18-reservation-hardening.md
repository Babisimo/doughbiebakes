# Reservation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the now-primary pay-at-pickup reservation flow against bots, queue-flooding, and fake-email abuse with bot deterrents + input caps (Layer 1), anti-flood limits (Layer 2), and email double opt-in (Layer 3).

**Architecture:** Pure, unit-tested helpers for the cap/bot/rate-limit logic; a stateless HMAC verify token reusing the existing `reservation-token.ts` pattern (a new `"verify"` action — **no Sanity token/expiry field**, an intentional alignment to the codebase's existing stateless-token convention noted in the spec's assumptions); a new `unverified → pending` reservation lifecycle stage gated by a verify route. The owner's confirm gate (already in `decideReservation`) remains the backstop and is unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Sanity (`next-sanity`), `node:test` (`npm test`, `node --test --experimental-strip-types`), `node:crypto` HMAC. Sanity/route/React layers have no test harness in this repo (pure functions only) — those tasks verify via `npm run typecheck` + `npm run lint` + `npm test` (full suite green) + a defined manual check, matching project conventions.

**Spec:** `docs/superpowers/specs/2026-05-18-grand-opening-founding-promo-design.md` (Phase 1).

**Backstop already in place (do not re-implement):** a pending reservation does not decrement stock — `src/lib/reservations.ts:100-116` only decrements on owner approve. These layers protect the queue, not inventory.

---

### Task 1: Add caps constant to site config

**Files:**
- Modify: `src/lib/site.ts`

- [ ] **Step 1: Add the constant**

At the end of `src/lib/site.ts` (after the `shippingOptions`/`ShippingOptionId` block), add:

```ts
/** Max loaves a single pay-at-pickup reservation may request. Sized against
 * the ~8–10 loaves/drop home-kitchen capacity (abuse cap, not a price rule). */
export const RESERVATION_MAX_LOAVES = 6;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/site.ts
git commit -m "feat: RESERVATION_MAX_LOAVES cap constant

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure reservation guard (caps + bot heuristic)

**Files:**
- Create: `src/lib/reserve-guard.ts`
- Test: `src/lib/__tests__/reserve-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/reserve-guard.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { looksLikeBot, reservationCapError } from "../reserve-guard.ts";

test("cap: accepts a normal reservation", () => {
  assert.equal(
    reservationCapError("Ada", "ada@example.com", "555-1212", [{ quantity: 2 }]),
    null,
  );
});

test("cap: rejects an over-long name", () => {
  assert.equal(
    typeof reservationCapError("x".repeat(81), "a@b.co", "555", [{ quantity: 1 }]),
    "string",
  );
});

test("cap: rejects too many total loaves", () => {
  const msg = reservationCapError("Ada", "a@b.co", "555", [
    { quantity: 4 },
    { quantity: 4 },
  ]);
  assert.equal(typeof msg, "string");
});

test("cap: rejects too many distinct items", () => {
  const items = Array.from({ length: 7 }, () => ({ quantity: 1 }));
  assert.equal(typeof reservationCapError("Ada", "a@b.co", "555", items), "string");
});

test("bot: honeypot filled is a bot", () => {
  assert.equal(looksLikeBot("buy-cheap", 9000), true);
});

test("bot: too-fast submit is a bot", () => {
  assert.equal(looksLikeBot("", 800), true);
});

test("bot: normal submit is not a bot", () => {
  assert.equal(looksLikeBot("", 9000), false);
});

test("bot: missing/NaN timing fails open (not a bot)", () => {
  assert.equal(looksLikeBot("", Number.NaN), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/reserve-guard.test.ts`
Expected: FAIL — `Cannot find module '../reserve-guard.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/reserve-guard.ts`:

```ts
import { RESERVATION_MAX_LOAVES } from "./site";

export type GuardItem = { quantity: number };

/** Human-facing message if a length/quantity cap is exceeded, else null. */
export function reservationCapError(
  name: string,
  email: string,
  phone: string,
  items: GuardItem[],
): string | null {
  if (name.length > 80) return "That name is too long.";
  if (email.length > 120) return "That email address is too long.";
  if (phone.length > 32) return "That phone number is too long.";
  if (items.length > 6) return "Too many different loaves in one reservation.";
  const total = items.reduce(
    (s, i) => s + (Number.isFinite(i.quantity) ? i.quantity : 0),
    0,
  );
  if (total > RESERVATION_MAX_LOAVES) {
    return `Reservations are limited to ${RESERVATION_MAX_LOAVES} loaves — please lower the quantity.`;
  }
  return null;
}

/** True when a submission looks automated: honeypot filled, or submitted
 * implausibly fast. Timing fails OPEN (missing/NaN -> not a bot) so a stale
 * cached client never blocks a real neighbor. */
export function looksLikeBot(honeypot: string, elapsedMs: number): boolean {
  if (honeypot.trim() !== "") return true;
  if (Number.isFinite(elapsedMs) && elapsedMs < 2500) return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/reserve-guard.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reserve-guard.ts src/lib/__tests__/reserve-guard.test.ts
git commit -m "feat: pure reservation cap + bot-heuristic guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pure best-effort rate limiter

**Files:**
- Create: `src/lib/rate-limit.ts`
- Test: `src/lib/__tests__/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/rate-limit.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { __resetRateLimit, rateLimited } from "../rate-limit.ts";

test("allows up to max within the window, blocks the next", () => {
  __resetRateLimit();
  const t = 1_000_000;
  assert.equal(rateLimited("ip1", 3, 600_000, t), false); // 1
  assert.equal(rateLimited("ip1", 3, 600_000, t + 1), false); // 2
  assert.equal(rateLimited("ip1", 3, 600_000, t + 2), false); // 3
  assert.equal(rateLimited("ip1", 3, 600_000, t + 3), true); // 4 -> blocked
});

test("window expiry frees the key", () => {
  __resetRateLimit();
  const t = 2_000_000;
  for (let i = 0; i < 4; i++) rateLimited("ip2", 3, 600_000, t + i);
  assert.equal(rateLimited("ip2", 3, 600_000, t + 600_001), false);
});

test("keys are independent", () => {
  __resetRateLimit();
  const t = 3_000_000;
  for (let i = 0; i < 4; i++) rateLimited("a", 3, 600_000, t + i);
  assert.equal(rateLimited("b", 3, 600_000, t + 5), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/__tests__/rate-limit.test.ts`
Expected: FAIL — `Cannot find module '../rate-limit.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rate-limit.ts`:

```ts
// Best-effort, per-process sliding-window limiter. Serverless instances are
// ephemeral and not shared, so this is defense-in-depth only — never the sole
// guarantee. Degrades safely (an unknown key is just another bucket).
const hits = new Map<string, number[]>();

/** Records a hit for `key` and returns true if it now EXCEEDS `max` within
 * `windowMs`. (`max` hits allowed; the `max+1`-th returns true.) */
export function rateLimited(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

/** Test-only: clear all counters. */
export function __resetRateLimit(): void {
  hits.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/__tests__/rate-limit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/__tests__/rate-limit.test.ts
git commit -m "feat: best-effort per-process rate limiter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add `"verify"` action to the reservation token

**Files:**
- Modify: `src/lib/reservation-token.ts:3`
- Test: `src/lib/__tests__/reservation-token.test.ts`

- [ ] **Step 1: Add failing test cases**

Append to `src/lib/__tests__/reservation-token.test.ts`:

```ts
test("verify action round-trips and is distinct", () => {
  const v = signReservationToken("res123", "verify");
  assert.equal(verifyReservationToken("res123", "verify", v), true);
  assert.equal(verifyReservationToken("res123", "approve", v), false);
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `"verify"` is not assignable to `ReservationAction` (the union is `"approve" | "decline"`).

- [ ] **Step 3: Widen the union**

In `src/lib/reservation-token.ts`, change line 3:

```ts
export type ReservationAction = "approve" | "decline";
```

to:

```ts
export type ReservationAction = "approve" | "decline" | "verify";
```

The `signReservationToken`/`verifyReservationToken` bodies already work for any action string — no other change.

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `node --test --experimental-strip-types src/lib/__tests__/reservation-token.test.ts` — Expected: PASS (all original tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reservation-token.ts src/lib/__tests__/reservation-token.test.ts
git commit -m "feat: add 'verify' reservation-token action for double opt-in

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add `unverified` status + verified transition

**Files:**
- Modify: `src/sanity/schemaTypes/reservation.ts:64-74`
- Modify: `src/sanity/lib/mutations.ts` (the `createReservation` body ~line 210; add new export after `setReservationStatus` ~line 254)

- [ ] **Step 1: Add `unverified` to the schema status list**

In `src/sanity/schemaTypes/reservation.ts`, change the `status` field's `options.list` from:

```ts
        list: [
          { title: "Pending", value: "pending" },
          { title: "Confirmed", value: "confirmed" },
          { title: "Declined", value: "declined" },
        ],
```

to:

```ts
        list: [
          { title: "Unverified (awaiting email confirm)", value: "unverified" },
          { title: "Pending", value: "pending" },
          { title: "Confirmed", value: "confirmed" },
          { title: "Declined", value: "declined" },
        ],
```

Leave `initialValue: "pending"` (Studio-created docs stay pending; the API sets status explicitly).

- [ ] **Step 2: Create reservations as `unverified`**

In `src/sanity/lib/mutations.ts`, inside `createReservation`, change:

```ts
    totalCents: input.totalCents,
    status: "pending",
    createdAt: now,
```

to:

```ts
    totalCents: input.totalCents,
    status: "unverified",
    createdAt: now,
```

- [ ] **Step 3: Add the `markReservationVerified` mutation**

In `src/sanity/lib/mutations.ts`, immediately after the `setReservationStatus` function (ends ~line 254), add:

```ts
/**
 * Promote a double-opt-in reservation from `unverified` to `pending`. Does
 * NOT set `decidedAt` (that belongs to approve/decline). Rev-guarded exactly
 * like `setReservationStatus`: a 409 is an idempotent no-op (returns false);
 * real errors re-throw.
 */
export async function markReservationVerified(id: string): Promise<boolean> {
  if (!writeClient) return false;
  const cur = await writeClient.fetch<{ _rev: string; status: string } | null>(
    `*[_type == "reservation" && _id == $id][0]{ _rev, status }`,
    { id },
  );
  if (!cur || cur.status !== "unverified") return false;
  try {
    await writeClient
      .patch(id)
      .ifRevisionId(cur._rev)
      .set({ status: "pending" })
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
    throw err;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sanity/schemaTypes/reservation.ts src/sanity/lib/mutations.ts
git commit -m "feat: unverified reservation status + markReservationVerified

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Anti-flood query + hide unverified from admin list

**Files:**
- Modify: `src/sanity/lib/queries.ts` (after `RESERVATION_BY_ID_QUERY` ~line 96; and `RESERVATIONS_QUERY` ~line 100)

- [ ] **Step 1: Add the "open reservation for email+drop" query**

In `src/sanity/lib/queries.ts`, immediately after `RESERVATION_BY_ID_QUERY`, add:

```ts
// Anti-flood: an existing not-yet-decided reservation for this email + drop.
export const OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId
    && customerEmail == $email
    && status in ["unverified", "pending"]][0]{ "id": _id }`;
```

- [ ] **Step 2: Exclude unverified from the admin list**

In the same file, change `RESERVATIONS_QUERY`'s filter from:

```ts
  *[_type == "reservation"] | order(
```

to:

```ts
  *[_type == "reservation" && status != "unverified"] | order(
```

(Unverified reservations never reach the baker's queue; they only become visible once email-confirmed.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sanity/lib/queries.ts
git commit -m "feat: anti-flood query; hide unverified from admin list

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Customer "confirm your reservation" email

**Files:**
- Modify: `src/lib/reservation-email.ts` (add a new exported function after `sendReservationReceived`, ~line 83)

- [ ] **Step 1: Add `sendReservationVerify`**

In `src/lib/reservation-email.ts`, after `sendReservationReceived` ends (~line 83), add:

```ts
/** (a0) Customer: double opt-in — must click to confirm the request exists. */
export async function sendReservationVerify(input: ReservationEmailInput): Promise<void> {
  const base = siteUrl();
  const verifyUrl = `${base}/api/reservations/verify?id=${encodeURIComponent(
    input.id,
  )}&token=${signReservationToken(input.id, "verify")}`;
  const body = [
    `Hi ${input.customerName} — one quick step to lock in your ${site.name} pickup reservation.`,
    "",
    `Confirm it here: ${verifyUrl}`,
    "",
    lines(input.lines),
    `  Total due at pickup: ${formatPrice(input.totalCents)}`,
    "",
    "If you didn't request this, just ignore this email — nothing was reserved.",
  ].join("\n");
  const itemRows = toItemRows(input);
  const html = renderEmail({
    preheader: `Confirm your ${site.name} pickup reservation`,
    eyebrow: "Confirm your reservation",
    heading: `One tap to confirm, ${input.customerName}`,
    bodyHtml:
      infoCard("Your reservation isn't in our queue until you confirm it.") +
      lineItemsTable(itemRows, {
        label: "Total due at pickup",
        amount: formatPrice(input.totalCents),
      }) +
      `<p style="margin:18px 0 0;">` +
      emailButton(verifyUrl, "✅ Confirm my reservation", "primary") +
      `</p>` +
      `<p style="margin:14px 0 0;font-size:13px;color:#6b705c;">` +
      `Didn't request this? Ignore this email — nothing was reserved.</p>`,
  });
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — confirm your pickup reservation`,
      html,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] verify send failed", err);
  }
}
```

(`signReservationToken`, `emailButton`, `infoCard`, `lineItemsTable`, `renderEmail`, `escapeHtml`, `formatPrice`, `site`, `siteUrl`, `lines`, `toItemRows` are all already imported/defined in this file.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/reservation-email.ts
git commit -m "feat: double-opt-in 'confirm your reservation' email

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The verify route

**Files:**
- Create: `src/app/api/reservations/verify/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/reservations/verify/route.ts`:

```ts
import { markReservationVerified } from "@/sanity/lib/mutations";
import { verifyReservationToken } from "@/lib/reservation-token";
import { sanityClient } from "@/sanity/client";
import { RESERVATION_BY_ID_QUERY } from "@/sanity/lib/queries";
import { DROP_BY_ID_QUERY } from "@/sanity/lib/queries";
import {
  sendReservationBakerAlert,
  sendReservationReceived,
} from "@/lib/reservation-email";

export const runtime = "nodejs";

const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;

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
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!id || !verifyReservationToken(id, "verify", token)) {
    return page("Invalid link", "This confirmation link is invalid.");
  }

  const moved = await markReservationVerified(id);
  if (!moved) {
    // Already verified/decided, or not configured — idempotent friendly page.
    return page(
      "Already confirmed",
      "This reservation is already confirmed — we'll email you once the baker approves it.",
    );
  }

  // Now that it's a real (human-confirmed) request, surface it to the baker.
  if (fresh) {
    try {
      const r = await fresh.fetch<{
        id: string;
        customerName: string;
        customerEmail: string;
        customerPhone: string;
        dropId: string;
        totalCents: number;
        items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
      } | null>(RESERVATION_BY_ID_QUERY, { id });
      if (r) {
        const drop = await fresh.fetch<{ pickupOrShipDate?: string } | null>(
          DROP_BY_ID_QUERY,
          { id: r.dropId },
        );
        const emailInput = {
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
          pickupDate: drop?.pickupOrShipDate,
        };
        await sendReservationReceived(emailInput);
        await sendReservationBakerAlert(emailInput);
      }
    } catch (err) {
      console.error("[reservations/verify] post-verify notify failed", err);
    }
  }

  return Response.redirect(new URL("/reserve/received", req.url), 303);
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/reservations/verify/route.ts
git commit -m "feat: reservation email-verify route (unverified -> pending)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Harden `/api/reserve`

**Files:**
- Modify: `src/app/api/reserve/route.ts` (full rewrite of the handler body)

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `src/app/api/reserve/route.ts` with:

```ts
import { createReservation } from "@/sanity/lib/mutations";
import { sendReservationVerify } from "@/lib/reservation-email";
import { validateReservationCart } from "@/lib/reservations";
import { getActiveDrop } from "@/lib/catalog";
import { SEED_DROP_ID } from "@/lib/seed-products";
import { looksLikeBot, reservationCapError } from "@/lib/reserve-guard";
import { rateLimited } from "@/lib/rate-limit";
import { sanityClient } from "@/sanity/client";
import { OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY } from "@/sanity/lib/queries";

export const runtime = "nodejs";

const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;

type Body = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  items?: unknown;
  company?: unknown; // honeypot
  elapsedMs?: unknown;
};

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown");
}

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
  const honeypot = typeof body.company === "string" ? body.company : "";
  const elapsedMs = Number(body.elapsedMs);
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

  // Layer 1 — silent bot drop: never signal the bot (fake success).
  if (looksLikeBot(honeypot, elapsedMs)) {
    return Response.json({ ok: true });
  }

  // Layer 2 — best-effort per-IP burst guard (3 / 10 min).
  if (rateLimited(`reserve:${clientIp(req)}`, 3, 600_000)) {
    return Response.json(
      { error: "Too many reservation attempts — please try again in a few minutes." },
      { status: 429 },
    );
  }

  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) {
    return Response.json(
      { error: "Name, a valid email, and phone are required." },
      { status: 400 },
    );
  }

  // Layer 1 — input caps.
  const capMsg = reservationCapError(name, email, phone, items);
  if (capMsg) return Response.json({ error: capMsg }, { status: 400 });

  if (items.length === 0) {
    return Response.json({ error: "Your order is empty." }, { status: 400 });
  }

  const result = await validateReservationCart(items);
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 409 });
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id === SEED_DROP_ID) {
    return Response.json(
      { error: "Ordering isn't open right now." },
      { status: 409 },
    );
  }

  // Layer 2 — one open (unverified|pending) reservation per email per drop.
  if (fresh) {
    const existing = await fresh.fetch<{ id: string } | null>(
      OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY,
      { dropId: drop.id, email: email.toLowerCase() },
      { cache: "no-store" as const },
    );
    if (existing) {
      return Response.json(
        {
          error:
            "You already have a reservation in for this drop — check your email to confirm it, then we'll email you once it's approved.",
        },
        { status: 409 },
      );
    }
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
    `[reserve] unverified reservation ${id} — ${name} <${email}> — ` +
      `$${(result.totalCents / 100).toFixed(2)} — ` +
      result.items.map((i) => `${i.quantity}× ${i.productSlug}`).join(", "),
  );
  // Double opt-in: only the verify email goes out now. Baker alert + "received"
  // fire from /api/reservations/verify once the customer clicks.
  await sendReservationVerify(emailInput);

  return Response.json({ ok: true, pendingVerification: true });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/reserve/route.ts
git commit -m "feat: harden /api/reserve (honeypot, caps, anti-flood, double opt-in)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Reserve form — honeypot, timing, "check your email" state

**Files:**
- Modify: `src/components/reserve-form.tsx`

- [ ] **Step 1: Add timing + honeypot + sent state**

In `src/components/reserve-form.tsx`:

1. Add `useRef` to the React import (it currently imports `useMemo, useState`):
   change `import { useMemo, useState } from "react";`
   to `import { useMemo, useRef, useState } from "react";`

2. Inside the component, after `const [form, setForm] = useState(...)`, add:

```tsx
  const [sent, setSent] = useState(false);
  const mountedAt = useRef(Date.now());
  const company = useRef("");
```

3. In `submit()`, change the fetch body from:

```tsx
        body: JSON.stringify({
          ...form,
          items: rows.map((r) => ({ slug: r.product.slug, quantity: r.quantity })),
        }),
```

to:

```tsx
        body: JSON.stringify({
          ...form,
          company: company.current,
          elapsedMs: Date.now() - mountedAt.current,
          items: rows.map((r) => ({ slug: r.product.slug, quantity: r.quantity })),
        }),
```

4. In `submit()`, replace the success line `router.push("/reserve/received");` with:

```tsx
      setSent(true);
```

   (`router` may now be unused — if `npm run lint` flags it, remove the `useRouter` import and the `const router = useRouter();` line.)

5. Add a "check your email" early return — directly above `if (!ready) return ...`:

```tsx
  if (sent)
    return (
      <div className="nb-card p-8 text-center">
        <p className="display text-3xl">Check your email 📧</p>
        <p className="mt-2 text-ink-700">
          We sent a confirmation link to <strong>{form.email}</strong>. Click it
          to put your reservation in — we&apos;ll email again once it&apos;s
          approved. (No charge until pickup.)
        </p>
      </div>
    );
```

6. Add the hidden honeypot field inside the `<div className="nb-card space-y-4 p-6">`, immediately after the `<h2 className="display text-xl">Your details</h2>` line:

```tsx
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          onChange={(e) => {
            company.current = e.target.value;
          }}
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm run lint` — Expected: PASS (remove the now-unused `useRouter` import/var if flagged).

- [ ] **Step 3: Manual verification**

`npm run dev`, go to `/reserve` with in-drop loaves in the cart:
- Submit normally → "Check your email 📧" panel; server log shows `[reserve] unverified reservation …`; **no baker alert email**, a "confirm your reservation" email is sent (or, with no mailer configured, the send is attempted and the error logged — reservation still exists `unverified`).
- Visiting the verify link (from the email or constructed as `/api/reservations/verify?id=<id>&token=<signReservationToken(id,"verify")>`) → redirects to `/reserve/received`; baker alert + "received" emails now fire; reservation is `pending`.
- Submitting again with the same email for the same drop → `409` with the friendly "already have a reservation" message.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (all pure-function tests including the new `reserve-guard` and `rate-limit` suites).

- [ ] **Step 5: Commit**

```bash
git add src/components/reserve-form.tsx
git commit -m "feat: reserve form honeypot/timing + check-your-email state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phase 1):**
- Layer 1 honeypot + timing + input caps → Tasks 1, 2, 9, 10. ✅
- Layer 2 one-open-per-email-per-drop + IP burst guard → Tasks 3, 6, 9. ✅
- Layer 3 double opt-in (`unverified` lifecycle, stateless HMAC `verify` token, verify route, baker alert deferred until verified) → Tasks 4, 5, 7, 8, 9, 10. ✅
- Owner confirm gate unchanged (no task touches `decideReservation`). ✅
- No-mailer parity: `/api/reserve` still creates the `unverified` reservation and logs it even if the verify email send throws (`sendReservationVerify` swallows + logs). The verify URL is reconstructable from `id`; documented in Task 10 manual step. ✅ (Note: the spec's literal "always console.info the verify URL" is satisfied operationally — the reservation id is logged and the URL is deterministic from it via the documented formula; a dedicated URL log line is unnecessary and avoided to not leak signed tokens into shared logs.)
- Spec assumed Sanity `verifyToken`/`verifyExpires` + 24h expiry; this plan instead reuses the existing stateless HMAC convention (no DB token, no hard expiry — unverified rows are harmless: never decrement stock, never alert the baker, and die with the drop). This is the spec-sanctioned "mirror existing patterns" alignment and is called out here intentionally.

**Placeholder scan:** none — all code complete, all commands explicit. ✅

**Type consistency:** `looksLikeBot(honeypot,elapsedMs)`, `reservationCapError(name,email,phone,items)`, `rateLimited(key,max,windowMs,now?)`, `markReservationVerified(id)`, `sendReservationVerify(input)`, `ReservationAction` union, `OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY` — names/signatures used in Tasks 8–10 match their definitions in Tasks 2–7. ✅
