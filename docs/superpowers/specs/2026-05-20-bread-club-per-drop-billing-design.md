# Bread Club — Per-Drop Billing Design Spec

**Date:** 2026-05-20
**Status:** Approved (pending user spec review)
**Author:** Brainstormed with the owner.

## Goal

Replace the Bread Club's fixed "$40 every 4 weeks" Stripe subscription with a
**charge-per-drop** model that fits a single home baker with an irregular
schedule: members keep a card on file, and are charged **$10 for a drop only
when the baker actually runs one**. A week with no drop charges nobody; a
member can skip any drop. HelloFresh-style — the charge follows a real bake,
not a calendar timer.

**No migration:** the Bread Club has no members yet, so the `member` schema and
flow are redesigned cleanly.

## Locked decisions

| Topic | Decision |
|---|---|
| Billing mechanism | **Card on file, no Stripe subscription.** Card saved via a Stripe `setup`-mode Checkout at join; charged per drop with off-session PaymentIntents. |
| Price | **$10 per drop** (+ $12 ship surcharge if the member chose shipping). |
| Charge trigger | **Manual** — the baker clicks "Charge members for this drop" in the admin. |
| Default participation | **Opt-out.** Silence = in (gets the default loaf + is charged). Explicit **skip** = not charged, no loaf. |
| No drop | Nothing fires — no drop, no charges. |
| Membership exit | **Manual only.** A member leaves by self-cancel or baker removal. Nothing automatic — chronic skipping and failing cards never auto-drop anyone. |
| Seat cap | 12 memberships, founding cohort = first 5 — both unchanged. |

## Stack constraints

- Next.js 16 (App Router), TypeScript, Sanity (`next-sanity`), Stripe SDK `^22`.
- Per `AGENTS.md`, Next.js 16 has breaking changes vs. older knowledge — verify route/API shapes against `node_modules/next/dist/docs/` before coding.
- Stripe features used: `mode: "setup"` Checkout Sessions, off-session `PaymentIntents` (`confirm: true`, `off_session: true`). Standard in SDK 22.
- Existing HMAC magic-link helper (`src/lib/reservation-token.ts`, signed with `CLUB_LINK_SECRET`) is the template for the new club-member links.

---

## 1. Data model

### `member` (redesigned — `src/sanity/schemaTypes/member.ts`)
Doc `_id` = the Stripe customer id (deterministic upsert, as today).

| Field | Type | Notes |
|---|---|---|
| `customerEmail` | string, required, email | |
| `stripeCustomerId` | string, required, readOnly | |
| `stripePaymentMethodId` | string, readOnly | The saved default card. Updated on card-update. |
| `status` | string: `active` \| `canceled` | `active` on join. |
| `joinedAt` | datetime, readOnly, required | |
| `canceledAt` | datetime, readOnly | Set on cancel/removal. |
| `founding` | boolean, readOnly | First 5 members ever; permanent (a cancel never frees a founding slot). |

**Removed:** `stripeSubscriptionId`, `subscriptionStatus`, `priceId`, `lastSyncedAt` (all subscription-only).

### `memberSelection` (`src/sanity/schemaTypes/memberSelection.ts`)
One per (drop, member) — the member's per-drop choice.

- Keep: `drop` (reference), `customerEmail`, `productSlug`, `fulfillment` (`pickup`/`ship`), `selectedAt`.
- **Add:** `skipped` (boolean) — `true` means the member opted out of this drop.
- **Remove:** `shipInvoiceItemId` (subscription-only).

A selection is either a loaf pick (`productSlug` + `fulfillment`) or `skipped: true`.

### `memberCharge` (new — `src/sanity/schemaTypes/memberCharge.ts`)
One per (drop, member) charge. Registered in the schema index.

| Field | Type | Notes |
|---|---|---|
| `member` | reference → member | |
| `drop` | reference → drop | |
| `customerEmail` | string, readOnly | Denormalized for admin display. |
| `amountCents` | number, readOnly | $10, or $22 with ship. |
| `status` | string: `paid` \| `failed` | |
| `stripePaymentIntentId` | string, readOnly | |
| `failureMessage` | string, readOnly | Decline reason, shown to the baker. |
| `chargedAt` | datetime, readOnly | |

**Idempotency:** `_id = charge.<dropId>.<stripeCustomerId>` — deterministic, so a member can't be charged twice for one drop.

---

## 2. Join flow

`src/app/api/bread-club/route.ts` — change `mode: "subscription"` → **`mode: "setup"`**:
- Front-line dedup against the Sanity member cache: block the join if an **`active`** member with that email exists (a previously `canceled` member may rejoin — fresh doc). Keep the 12-seat cap check.
- Create a `setup`-mode Checkout Session: `customer_email` prefilled, `metadata: { kind: "club-join" }`, `success_url` → `/order/success?...&club=1`, `cancel_url` → `/bread-club`. Charges $0 — it only saves a card.
- The route's `enabled` gate switches from `Boolean(process.env.STRIPE_BREAD_CLUB_PRICE_ID)` to "Stripe is configured" (`getStripe()` non-null). `STRIPE_BREAD_CLUB_PRICE_ID` is no longer used anywhere.

Webhook handles completion (see §7): retrieve the SetupIntent → PaymentMethod, set it as the customer's default, create the `active` `member` doc with the founding tag.

## 3. Per-drop charge flow

**Admin:** a "Charge members for this drop" button in the admin drop view (`src/app/admin/club/[dropId]/page.tsx`). The button disables while its request is in flight.

**New route:** `POST /api/admin/club/charge`, body `{ dropId }`, guarded by the admin session (same `getAdminSession()` gate as `/api/reservations/decide`).

**Logic** — for the drop, load all `active` members, their `memberSelection`s, and existing `memberCharge`s. For each active member, sequentially:
1. Selection is `skipped` → skip, no charge.
2. A `memberCharge` already exists with `status: "paid"` → skip (idempotent).
3. Otherwise charge: `amount = 1000` (+ `1200` if their selection's `fulfillment === "ship"`). A member with **no** selection → default loaf, pickup, $10.
   - `stripe.paymentIntents.create({ amount, currency: "usd", customer: <id>, payment_method: <member.stripePaymentMethodId>, off_session: true, confirm: true, metadata: { dropId, customerEmail, kind: "club-drop" } })`.
   - Success → write/replace the `memberCharge` doc `status: "paid"` (deterministic `_id`).
   - Decline → Stripe throws `StripeCardError`; catch it → `memberCharge` `status: "failed"` + `failureMessage`; trigger the decline email (§5).
4. Return a summary: `{ paid, failed, skipped }` counts + the failed members' emails/reasons.

**Re-runnable:** because `paid` members are skipped and `failed`/un-attempted members are (re)attempted, clicking "Charge members" again simply retries the failures — no separate "retry" action needed. The in-flight button-disable plus sequential server processing closes the only practical double-charge race (a single baker double-clicking).

## 4. Skip flow

The per-drop loaf-picker (`src/app/club/[dropId]/selection-form.tsx`) gains a **"Skip this drop"** button alongside the pick-a-loaf form.
- Skipping POSTs to the existing selection API (`src/app/api/club/select/route.ts`) with a skip flag → upserts the member's `memberSelection` with `skipped: true`.
- A member can change their mind (pick a loaf instead) while the order window is open. Once the baker has charged the drop, the selection is effectively locked (a `paid`/`failed` `memberCharge` exists).
- `getMemberSelectionsForDrop` (`src/lib/catalog.ts`): a `skipped` member is **excluded** — no default loaf auto-assigned, not counted as participating, doesn't reserve a loaf. A member who neither picked nor skipped still gets the default loaf (opt-out).

## 5. Declined cards

A failed off-session charge → `memberCharge` `status: "failed"` + `failureMessage`, surfaced in the baker's charge summary and the admin drop view.
- The member is emailed: *"Your card was declined for [drop] — update it to stay in the Bread Club"* with a card-update magic link.
- The baker re-clicks "Charge members" after the member fixes their card; only the unpaid are retried.
- A failed/unpaid member shows clearly in the admin as unpaid. Whether to still bake their loaf is the baker's judgement — the system never auto-withholds a loaf or auto-removes the member.

## 6. Card update & cancellation

Both are signed magic-link routes (HMAC via `CLUB_LINK_SECRET`, keyed to the Stripe customer id), reusing the `reservation-token.ts` pattern. Links are surfaced in the member-facing emails (the per-drop selection emails, the decline email, the join confirmation).

- **Update card** — `GET /api/club/update-card?customer=<id>&token=<hmac>` → a Stripe `setup`-mode Checkout Session for the **existing** customer, `metadata: { kind: "club-card-update" }` → member enters a new card → webhook sets it as the new default and updates `member.stripePaymentMethodId`.
- **Cancel** — `GET /api/club/cancel?customer=<id>&token=<hmac>` → sets `member.status = "canceled"`, `canceledAt`; renders a confirmation page. Instant and clean (no subscription, no billing period). The member is excluded from all future charges and the seat frees up.

## 7. Membership lifecycle

A member leaves the club **only** by:
1. **Self-cancel** (§6) — the "Leave the Bread Club" magic link.
2. **Baker removal** — an admin "Remove from club" action in the admin club view → `member.status = "canceled"`, `canceledAt` (a small admin route, or an extension of an existing admin club route).

**Nothing automatic ever drops a member.** Chronic skipping keeps the seat (skipping freely is the model's whole point). A chronically failing card surfaces as repeated failed `memberCharge`s + nudge emails, but removal is always the baker's manual call. Founding status is permanent — a cancel never reopens a founding slot.

## 8. Webhook changes (`src/app/api/webhooks/stripe/route.ts`)

- `checkout.session.completed`:
  - `mode === "payment"` → public order — **unchanged**.
  - `mode === "setup"` → branch on `metadata.kind`:
    - `club-join` → retrieve the SetupIntent, set its PaymentMethod as the customer's default, create the `member` doc (`active`, founding logic).
    - `club-card-update` → set the new PaymentMethod as default, patch `member.stripePaymentMethodId`.
- **Delete** `handleSubscriptionEvent` and the `customer.subscription.created/updated/deleted` cases entirely.
- Off-session PaymentIntents resolve synchronously inside the charge route, so **no webhook handler is needed for drop charges** (no `payment_intent.*` handling — YAGNI).

## 9. Config, copy, cleanup

- `site.breadClub` (`src/lib/site.ts`): `priceLabel: "$10"`, `cadenceLabel: "per drop"`. Remove `perLoafLabel` and `loavesPerCycle` (no "cycle"). Keep `seats: 12`, `foundingSeats: 5`, `defaultLoafSlug`, `shipSurchargeCents: 1200`.
- `/bread-club` page (`src/app/bread-club/page.tsx`): update price copy to read "$10 per drop"; rewrite the perks list (no "4 loaves per billing cycle" — instead "one loaf per drop, $10, skip any drop you don't want"); update the join-card copy. The membership/founding hero (just shipped) is unaffected — it reads live counts.
- Queries (`src/sanity/lib/queries.ts`): `ACTIVE_MEMBERS_QUERY`, `ACTIVE_MEMBER_COUNT_QUERY`, `MEMBER_BY_EMAIL_QUERY` — change the `subscriptionStatus in ["active","trialing"]` filter to `status == "active"`. `FOUNDING_MEMBER_COUNT_QUERY` is unchanged (counts `founding == true` regardless of status — correct, founding is permanent).
- Mutations (`src/sanity/lib/mutations.ts`): replace the subscription-shaped `upsertMember` with `createClubMember` (join), `setMemberCard` (card-update), `cancelMember` (cancel/removal), and `recordMemberCharge` (the `memberCharge` upsert). Remove subscription assumptions.

## Edge cases

- Baker double-clicks "Charge members" → `paid` members skipped; button disables in-flight; sequential processing. Safe.
- Member cancels mid-window after picking a loaf → excluded from the charge run; the selection is moot.
- Member updates a card after a failed drop charge → the next "Charge members" picks them up.
- Silent member (no selection) → default loaf, charged $10 pickup.
- Skipped member → no loaf, not charged, excluded from the bake list.
- Canceled member rejoining → fresh Stripe customer + fresh `member` doc; the old `canceled` doc remains as history.
- Zero-config (no Stripe / no Sanity) → `/bread-club` falls back to the waitlist; no joins or charges possible; pages degrade as today.
- Webhook redelivery of a `setup` completion → `createClubMember` is idempotent (`createIfNotExists`, `_id` = customer id).

## Phased rollout (for the implementation plan)

1. **Data model** — `member` redesign, `memberSelection` + `skipped`, new `memberCharge` schema, schema-index registration, queries, mutations.
2. **Join flow** — `setup`-mode checkout + webhook member creation.
3. **Per-drop charge** — admin route + button + `memberCharge` + off-session PaymentIntents + charge-summary UI.
4. **Skip** — selection-form button + select API + `getMemberSelectionsForDrop`.
5. **Card update + cancel** — magic-link routes + webhook card-update branch + decline email.
6. **Config / copy / cleanup** — `site.breadClub`, `/bread-club` copy, delete `handleSubscriptionEvent` and `STRIPE_BREAD_CLUB_PRICE_ID` usage.

## Open questions / assumptions

- **Assumption:** `CLUB_LINK_SECRET` (already used for reservation magic links) is reused to sign the club-member cancel / card-update links.
- **Assumption:** member-facing per-drop emails continue to be sent via the existing `club-emails` / `club-link` script mechanism; the cancel and card-update links ride inside those emails. The decline email (§5) is sent automatically by the charge route.
- **Assumption:** off-session PaymentIntents created with `confirm: true` resolve synchronously (success or `StripeCardError`); no asynchronous `payment_intent` webhook is needed. The implementation plan's first Stripe step verifies this against SDK 22.
- **Assumption:** the admin "Remove from club" action is acceptable as a plain admin-session-guarded route (no extra confirmation flow beyond a UI confirm).
