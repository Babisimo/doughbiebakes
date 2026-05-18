# Grand-Opening Founding Promo + Reservation Hardening — Design Spec

**Date:** 2026-05-18
**Status:** Approved (pending user spec review)

## Goal

A brand-new CA Cottage Food home bakery (no clients yet, ~8–10 loaves per drop) wants a grand-opening push that (a) drives Bread Club monthly subscriptions, (b) gives the first handful of customers a founding discount that works on the now-primary **pay-at-pickup** path *and* online Stripe orders, and (c) hardens the pay-at-pickup reservation flow against trolls/bots/scammers without punishing real neighbors.

## Locked decisions

| Topic | Decision |
|---|---|
| Bread Club offer | **Founding-member bonus loaf** in first delivery for the first **5** subscribers. Full $40 collected — no Stripe discount. |
| Founding code mechanic | **App-managed code** in Sanity, shared redemption cap, validated server-side on **both** reservation and Stripe one-off paths. |
| Discount | **15%** off the loaf subtotal. |
| Cap | **First 5** redemptions (shared across both paths), sized to 8–10 loaves/drop capacity. |
| Reservation redeem timing | Counter commits **on owner confirmation** (Stripe path: on payment completion). "Spots left" at submit is approximate. |
| Abuse layers in scope | Layer 1 (bot deterrents + input caps), Layer 2 (anti-flood), Layer 3 (email double opt-in). |
| Abuse layers deferred | Layer 4 (no-show blocklist + per-contact code limit), Layer 5 (Cloudflare Turnstile). Residual risk documented below. |

## Build order (this spec is internally phased)

The reservation **lifecycle** changes (Layer 3 double opt-in adds an `unverified` status) and the founding code both attach to the reservation flow. Build in this order so the lifecycle is settled before the code rides on it:

1. **Phase 1 — Reservation hardening** (Layers 1–3).
2. **Phase 2 — Founding code** (Sanity model + both paths) on top of the settled lifecycle.
3. **Phase 3 — Bread Club founding bonus loaf** (independent of 1–2).
4. **Phase 4 — Minimal discoverability copy.**

Rationale for keeping it one spec: the code's integrity depends on the hardened lifecycle; splitting would force reworking the reservation status model twice. The checkout reorder is a separate spec (`2026-05-18-checkout-option-reorder-design.md`); implement that first.

---

## Phase 1 — Reservation hardening

Backstop already in place: a pending reservation does **not** decrement stock or reduce availability — `decideReservation` (`src/lib/reservations.ts`) only calls `decrementDropQuantities` after the owner approves. Nothing is baked/held until the human confirms. Layers below protect the *queue and the owner's time*, not inventory.

### Layer 1 — Bot deterrents + input caps

Files: `src/components/reserve-form.tsx`, `src/app/api/reserve/route.ts`.

- **Honeypot:** add a visually-hidden, `autoComplete="off"`, `tabIndex={-1}` decoy input (name `company`) to the reserve form, off-screen via existing utility classes. If non-empty on POST → respond `200 {ok:true}` (silent accept, create nothing). Never signal the bot.
- **Timing check:** the form records render time (`useRef(Date.now())` set on mount); include `elapsedMs` in the POST body. Server silently drops (fake-ok, create nothing) if `elapsedMs < 2500`. Documented as best-effort heuristic.
- **Input caps** in `/api/reserve` (after JSON parse, before validation): `name` ≤ 80, `email` ≤ 120, `phone` ≤ 32 chars; `items` array ≤ 6 entries; total loaves (sum of quantities) ≤ `RESERVATION_MAX_LOAVES = 6` (new constant in `src/lib/site.ts`, sized vs. 8–10/drop). Length-cap violations → `400` with a clear human message; structurally bot-shaped payloads (honeypot/timing) → silent fake-ok.

### Layer 2 — Anti-flood

- **One open reservation per email per drop:** before `createReservation`, query Sanity for an existing reservation with the same normalized (lowercased, trimmed) email + this `dropId` and status in (`unverified`, `pending`). If one exists → `409` with a friendly message: *"You already have a reservation in for this drop — we'll email you once it's confirmed."* No new infra (one GROQ query).
- **In-memory per-IP burst guard** in `/api/reserve`: ≤ 3 submissions per 10 min per client IP (from `x-forwarded-for`/request). Module-level `Map` with timestamp pruning. Explicitly best-effort (per serverless instance, not a hard guarantee) — defense-in-depth only; degrades safely if IP is unavailable (skip the guard, never hard-fail a legit user).

### Layer 3 — Email double opt-in (keystone)

- **`reservation` schema** (`src/sanity/schemaTypes/reservation.ts`): extend the `status` value set to include **`unverified`** (lifecycle: `unverified → pending → confirmed | declined`). Add `verifyToken` (string, readOnly) and `verifyExpires` (datetime, readOnly).
- **`/api/reserve`:** create the reservation as `status: "unverified"` with a cryptographically random url-safe `verifyToken` (32 bytes, `crypto.randomUUID()`-grade or `randomBytes`) and `verifyExpires` = now + 24h. Send the customer a **"Confirm your reservation"** email containing the verify link. **Do NOT send the baker alert here.**
- **New route** `src/app/api/reservations/verify/route.ts` (`GET ?token=`): look up the `unverified` reservation by `verifyToken`. If found and not past `verifyExpires` → transition `unverified → pending` (reuse/extend the existing concurrency-safe `setReservationStatus` pattern guarding `from === "unverified"`), then send the baker alert and redirect to the existing `/reserve/received` page. Idempotent: an already-`pending` token → friendly "already confirmed" (redirect to `/reserve/received`). Expired/invalid/declined → clear error page/message.
- **Owner flow unchanged:** `decideReservation` continues to act only on `pending`. `unverified` rows never reach the owner's queue or the baker alert, so fake-email spam never enters the workflow and the system never email-bombs a third party (a single verify mail goes only to the submitted address; if it's not theirs, nothing else is ever sent).
- **Zero-config / no-mailer parity:** if the mailer is not configured (dev/demo), the verify URL is `console.info`-logged (the route already logs reservation details) so the dev flow is not blocked. Define explicitly: reservation is still created `unverified`; the verify link is always logged regardless of mailer state.

---

## Phase 2 — Founding discount code

### Sanity model

New document type `promoCode` (`src/sanity/schemaTypes/promoCode.ts`, registered in the schema index):

| Field | Type | Notes |
|---|---|---|
| `code` | string, required | Stored/compared **normalized** = `trim().toUpperCase()`. Seed/default value: `FOUNDING`. |
| `percentOff` | number, required | `15` for launch. 1–100. |
| `maxRedemptions` | number, required | `5` for launch. |
| `redeemedCount` | number, default `0` | Authoritative shared counter. |
| `active` | boolean, default `true` | Master on/off. |
| `label` | string, optional | Admin-only description. |

### Shared lib `src/lib/promo.ts`

- `getPromoByCode(code, { fresh })` → normalized lookup, returns the promo or `null`.
- `isRedeemable(promo)` → `promo.active && promo.redeemedCount < promo.maxRedemptions`.
- `discountCents(subtotalCents, percentOff)` → **exact rule, used by both paths:** `Math.round(subtotalCents * percentOff / 100)`. Discounted total = `subtotalCents - discountCents(...)`.
- For the Stripe path, per-unit: `discountedUnit = Math.max(1, unit - Math.round(unit * percentOff / 100))`. Documented rounding so reservation and Stripe agree within rounding of one cent per unit.

### Concurrency-safe redeem mutation

`redeemPromo(normalizedCode)` in `src/sanity/lib/mutations.ts`: a conditional atomic increment that succeeds only while `redeemedCount < maxRedemptions`, following the existing concurrency-safe `setReservationStatus` / `setFulfillmentStatus` compare-and-set pattern. Returns `boolean` (true = a slot was claimed). Never throws into callers (logs + returns false on error).

### Reservation path

- `reserve-form.tsx`: optional **"Promo code"** text input; include trimmed `code` in the `/api/reserve` body.
- `/api/reserve`: after cart validation, if `code` present, `getPromoByCode(code,{fresh})`. If found & `isRedeemable` → store on the (unverified) reservation: `promoCode` (normalized), `promoPercentOff`, `discountedTotalCents` (and keep original `totalCents`). **Do not redeem here.** If code present but invalid/exhausted → still create the reservation at full price; include a non-fatal `notice` in the JSON response (`"That code isn't valid or is fully claimed — reserved at full price."`). A bad code never blocks a legit reservation.
- `reservation` schema: add optional `promoCode` (string), `promoPercentOff` (number), `discountedTotalCents` (number).
- Owner confirm (`decideReservation`, action `approve`): if the reservation carries a `promoCode`, call `redeemPromo(code)` *after* the `pending → confirmed` claim succeeds.
  - `redeemPromo` true → confirmed at the discounted price; confirm email + admin show original / −15% / discounted total (the amount the owner charges at pickup).
  - `redeemPromo` false (cap exhausted by confirm time) → still confirm, but at **full price**; `DecideResult` carries a clear warning surfaced in the admin UI/decide response: *"Founding code already fully redeemed — confirmed at full price. Honor manually if you choose."* This realizes the "approximate at submit, exact at confirm" decision.
- `src/lib/reservation-email.ts`: when a discount is applied, render original, discount %, and discounted total in the received + confirmed emails.

### Stripe one-off path

- `cart-contents.tsx`: optional promo-code input in the summary aside, placed **above** the CTAs from the checkout-reorder spec. Include trimmed `code` in the `/api/checkout` body.
- `/api/checkout/route.ts`: if `code` present, `getPromoByCode(code,{fresh})` & `isRedeemable`. If valid, reduce each line item's `price_data.unit_amount` per the per-unit rule above. **Keep the existing `allow_promotion_codes: true`** (no Stripe coupon object — avoids the Stripe constraint that `discounts` and `allow_promotion_codes` are mutually exclusive). Add `promo: <normalizedCode>` to session `metadata` (alongside the existing `cart` key). A bad code → proceed at full price (no hard error).
- Webhook `src/app/api/webhooks/stripe/route.ts` `handleCompletedCheckout`: when `session.mode === "payment"` && `session.livemode` && `session.metadata.promo` present → `redeemPromo(promo)`. If false (cap exceeded by completion): the customer **already paid** the discounted amount — **do not claw back**; log a distinct greppable warning (`[promo] OVER-CAP REDEMPTION HONORED <session.id>`).

### Known, documented tradeoffs

- Validation at entry is best-effort vs. the live counter; the counter commits at confirm/payment. With cap = 5 and neighbors-only launch traffic, a rare 1–2 overage on the Stripe path is possible and **accepted** (never clawed back). Same tolerance style as the project's existing documented order→drop attribution race.
- **Deferred Layer 4 residual risk:** without a per-email/phone code limit, one determined person could redeem the founding code across multiple *distinct verified* emails. Partially mitigated by Layer 3 (each redemption needs a real, clicked inbox) and the owner confirm gate (the owner sees names/phones and can decline obvious duplicates). Flagged for reconsideration.

### Zero-config parity

No Sanity / no `promoCode` doc → `getPromoByCode` returns `null` → codes silently not applied, reservation and checkout proceed at full price, no crash. Mirrors how Stripe/Bread Club already degrade.

---

## Phase 3 — Bread Club founding bonus loaf

- **Config:** `site.breadClub.foundingSeats = 5` (new field in `src/lib/site.ts`).
- **`member` schema** (`src/sanity/schemaTypes/member.ts`): add `founding` (boolean, readOnly, optional).
- **`upsertMember`** (`src/sanity/lib/mutations.ts`): `founding` is assigned **exactly once, at member-document creation**. Before the `createIfNotExists`, check whether a doc with that `_id` (Stripe customer id) already exists; if not, query the count of existing members with `founding == true` — if `< foundingSeats`, include `founding: true` in the create payload. The subsequent `patch` (sync path) must **never** set/unset `founding`. Low volume (Cottage-Food scale) → a read-then-create race is negligible and consistent with existing read-then-write patterns in this file; documented as accepted.
- **Owner visibility (so the bonus loaf is remembered):**
  - Studio `member` preview subtitle prefixes `★ FOUNDING · ` when `founding`.
  - Admin club view `src/app/admin/club/[dropId]/page.tsx`: a "FOUNDING — add bonus loaf" badge next to a founding member's selection. No automated "first delivery done" tracking (YAGNI) — the owner adds the extra loaf to that member's first box by judgement.
- **`/bread-club` copy:** add one perk/announcement line: *"Founding members — the first 5 to join — get a bonus loaf in their very first delivery."* Static text (no live founding counter; explicitly out of scope as a future enhancement). Stacks with the existing limited-seats scarcity already rendered on the page.

---

## Phase 4 — Minimal discoverability

A code/offer is useless unseen. Copy-only, deliberately minimal (flagged for easy later expansion):

- `src/app/page.tsx` (homepage): a short grand-opening announcement line/badge — *"Now open — first 5 orders get 15% off with code FOUNDING. Bread Club founding members get a bonus loaf."*
- `/bread-club` page: the founding-loaf line from Phase 3 (already covered).

No banner system, countdown, or notify-list (not requested; YAGNI). Tell-me-later hook noted.

---

## Edge cases & failure modes

- Bad/empty/exhausted code anywhere → proceed at full price, friendly non-fatal notice; never blocks an order/reservation.
- Honeypot/timing trip → silent fake-`200`; nothing created; bot gets no signal.
- Verify token expired/reused/invalid → clear message; idempotent for already-verified.
- `redeemPromo` Sanity error → returns false, logged; reservation/order still completes (full price for that one), Stripe webhook still returns 200.
- Stripe over-cap at completion → honor (already paid), log greppable warning.
- No mailer (dev/demo) → reservation created `unverified`, verify URL logged; flow not blocked.
- Member sync events after creation → `founding` never changes.
- Spec A (checkout reorder) and this spec both edit the cart aside — A first, then the promo input layers above its CTAs.

## Verification

- **Layer 1:** filling the honeypot or submitting <2.5s → no reservation created, response `200`. Oversized name/too many loaves → `400` with message.
- **Layer 2:** second open reservation, same email+drop → `409` friendly message. >3 rapid submits from one IP (single instance) → throttled.
- **Layer 3:** submit → reservation is `unverified`, customer gets verify email, **no baker alert**; clicking the link → `pending` + baker alert fires + `/reserve/received`. Reused link → idempotent.
- **Phase 2:** valid code on reservation → discount stored, counter unchanged; on owner approve → counter +1, confirm email shows discounted total; 6th redemption → confirmed full price + owner warning. Valid code via Stripe → discounted `unit_amount`, `metadata.promo` set, webhook increments shared counter.
- **Phase 3:** first 5 new members get `founding:true` and the admin/Studio badge; 6th does not. `/bread-club` shows the founding line.
- `npm run lint`, `npm run typecheck`, and `npm test` clean. Manual GA4-style verification not applicable (parked).

## Open questions / assumptions

- **Assumption:** founding Bread Club cohort size = **5** (mirrors the code cap; configurable via `site.breadClub.foundingSeats`). Surfaced for the user to adjust at spec review.
- **Assumption:** the founding code default string is `FOUNDING`; the owner can rename it via the Sanity `promoCode` doc.
- **Assumption:** reservation `verifyExpires` window = 24h; adjustable.
- **Assumption:** the existing concurrency-safe `setReservationStatus`/`setFulfillmentStatus` mutation pattern is the template for `redeemPromo` and the `unverified→pending` transition; the implementation plan's first step reads that code to mirror it exactly.
- **Deferred (acknowledged):** Layer 4 (no-show blocklist + per-contact code limit) and Layer 5 (Turnstile); residual code-reuse risk documented above.
