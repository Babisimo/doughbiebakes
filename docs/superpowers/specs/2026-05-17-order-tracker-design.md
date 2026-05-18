# Admin Order-Progression Tracker — Design

**Date:** 2026-05-17
**Status:** Approved (pending user spec review)
**Builds on:** the combined bake list (sub-project B, shipped 2026-05-17)

## Problem

The baker (admin) has no way to track an individual order/reservation through
fulfillment. The combined bake list shows *who ordered what* for the active
drop, but not *what's been baked, what's ready, what's gone out* — so there's
no way to see whose order is slipping behind the drop's pickup/ship date.

## Goal

Let the admin advance each paid order and each confirmed reservation through
**New → Baking → Ready → Sent**, on the existing bake-list page, with an
automatic on-track / due-soon / behind / done signal derived from the drop's
pickup/ship date. Admin-only. No customer-facing surface.

## Locked decisions (with user)

1. **What's tracked:** paid public **orders** + **confirmed reservations**
   only. Bread Club member picks stay an untracked batch (no per-member
   progression).
2. **Stages:** `new` → `baking` → `ready` → `sent` (4 stages).
   - New = came in, not started. Baking = being made. Ready = baked, awaiting
     pickup/handoff or shipment. Sent = handed to customer / shipped (done).
3. **Delay signal:** derived automatically from the drop's `pickupOrShipDate`
   + the item's stage + now. Never stored. (`on-track` / `due-soon` /
   `behind` / `done`.)
4. **UI form:** inline on the existing `/admin/club/[dropId]` bake list
   (Approach A). No separate board/page.

## Architecture

```
order schema       + fulfillmentStatus: "new"|"baking"|"ready"|"sent"  initialValue "new"
reservation schema + fulfillmentStatus: same (INDEPENDENT of existing `status`)

src/lib/fulfillment.ts  (NEW — pure, no imports of server-only, node:test-reachable)
  STAGES, STAGE_LABELS, ADVANCE_LABELS
  next(stage)/prev(stage)         → adjacent stage or null
  isAdjacentTransition(from,to)   → boolean (exactly one step either direction)
  deriveDelay(stage, pickupOrShipDate, now) → "on-track"|"due-soon"|"behind"|"done"
  summarize(rows)                 → { byStage: Record<stage,number>, behind, dueSoon }

src/sanity/lib/mutations.ts
  + setFulfillmentStatus(type, id, fromStatus, toStatus): Promise<{ok,conflict?}>
    concurrency-safe: fetch _rev + current fulfillmentStatus (+ status for
    reservation); commit ifRevisionId only if current === fromStatus;
    reservation also requires status == "confirmed".

src/app/api/admin/fulfillment/route.ts  (NEW)
  POST { type:"order"|"reservation", id, from, to }  — getAdminSession()-gated

src/components/fulfillment-control.tsx  (NEW — client)
  badge + "Advance →" + small "‹ Back"; fetch → router.refresh()

src/sanity/lib/queries.ts + src/lib/catalog.ts
  LIVE_ORDERS_FOR_DROP_QUERY / CONFIRMED_RESERVATIONS_FOR_DROP_QUERY
  also project "fulfillmentStatus": coalesce(fulfillmentStatus,"new")

src/lib/bake-list.ts
  OrderSource/ReservationSource + fulfillmentStatus; BakeOrderRow/
  BakeReservationRow carry `fulfillmentStatus`. (Pure module stays pure;
  delay is derived in the page via fulfillment.ts, not in bake-list.ts.)

src/app/admin/club/[dropId]/page.tsx
  top fulfillment summary line; new "Status" column (badge + delay chip +
  <FulfillmentControl/>) on Public orders & Confirmed reservations tables.
```

Rationale: a **separate** `fulfillmentStatus` keeps approval
(reservation.status) and fulfillment orthogonal — a reservation can be
`confirmed` + `baking`. `initialValue:"new"` + GROQ `coalesce(...,"new")`
means zero migration for existing docs. Delay is **derived, never stored**,
so it cannot drift. All pieces mirror existing patterns
(`setReservationStatus`, the reservations decide route, `ReservationActions`,
the pure `bake-list.ts`/`reservation-eval.ts` convention).

## Status transitions

- `STAGES = ["new","baking","ready","sent"]`. Control shows **Advance →**
  (current→next) and **‹ Back** (current→prev). No skipping. `sent` has no
  Advance; `new` has no Back.
- `setFulfillmentStatus` fetches the doc's `_rev` and current
  `fulfillmentStatus`. If current !== `fromStatus` → no-op
  `{ok:false, conflict:true}`. Else patch `.ifRevisionId(_rev).set({
  fulfillmentStatus: toStatus })` and commit. A 409 revision conflict is
  swallowed as `{ok:false, conflict:true}` (mirrors `setReservationStatus`);
  other errors re-throw.
- `type:"reservation"` additionally requires the doc's `status ==
  "confirmed"`; otherwise `{ok:false}`.
- The route rejects a `to` that is not `isAdjacentTransition(from,to)` with
  `409` (tamper guard against "jump to sent").

## Delay derivation (pure)

`deriveDelay(stage, pickupOrShipDate, now)`:

1. `stage === "sent"` → `done`.
2. else `pickupOrShipDate` falsy/unparseable → `on-track`.
3. else if `stage === "ready"` → `on-track` (baked & waiting is safe even
   past the date).
4. else if `now >= pickupOrShipDate` → `behind`.
5. else if `pickupOrShipDate - now <= 24h` → `due-soon`.
6. else → `on-track`.

(`stage` here is `new`/`baking` by the time rules 4–6 apply.) `summarize`
returns per-stage counts plus `behind` and `dueSoon` totals for the page's
top roll-up line.

## UI (inline on the bake list)

- **Top summary** (under Bake totals / above Public orders): e.g.
  `Fulfillment: 3 new · 2 baking · 1 ready · 4 sent — ⚠ 2 behind, 1 due soon`.
  Omitted/neutral when nothing tracked.
- **Public orders** + **Confirmed reservations** tables: one new rightmost
  **Status** column —
  - stage **badge** (reuse existing `badge` classes; `new` neutral, `baking`
    amber/`badge-acid`, `ready` `badge-sage`, `sent` muted ✓),
  - **delay chip** from `deriveDelay`: nothing for `on-track`; `⚠ due soon`
    amber; `⚠ BEHIND` flame; `✓ done` muted,
  - `<FulfillmentControl type id from>` — primary **Advance →** (label hints
    next: "Start baking" / "Mark ready" / "Mark sent") + small **‹ Back**;
    disabled in-flight; success/conflict → `router.refresh()`; network error
    → inline message + re-enable (same UX as `ReservationActions`).
- Members section, Bake-totals card, everything else: unchanged.
- Row order unchanged (oldest first; no behind-first auto-sort — chip +
  summary surface urgency without reshuffling). Tables already
  `overflow-x-auto` for mobile.

## Error handling & edge cases

- **Demo mode** (no Sanity): no tracked rows, no control; `setFulfillmentStatus`
  returns `{ok:false}` → client refresh no-op. No crash.
- **Stale/concurrent advance:** `ifRevisionId` + `from`-guard → clean no-op
  `{ok:false,conflict:true}`; client always refreshes to stored truth. No
  double-advance.
- **Reservation not confirmed:** mutation guards `status=="confirmed"`;
  controls only render in the Confirmed table anyway (defense in depth).
- **Legacy docs lacking the field:** schema `initialValue:"new"` + GROQ
  `coalesce(fulfillmentStatus,"new")` → reads as `new`, zero migration.
- **API validation:** `type ∈ {order,reservation}`, `id` non-empty string,
  `from`/`to ∈ STAGES`, `isAdjacentTransition(from,to)` — else `400`/`409`.
  Unauthenticated → `401`.
- **No `pickupOrShipDate`:** `deriveDelay` → `on-track` (no false behind).
- **Network error client-side:** inline message + buttons re-enabled; status
  is server-authoritative, nothing lost.
- **`sent` terminal-ish:** no Advance past `sent`; Back still works
  (misclick recovery) — internal tool, no hard lock.

## Testing

`src/lib/__tests__/fulfillment.test.ts` (`node:test`, pure):

1. `next`/`prev` walk the ladder; saturate (`next("sent")===null`,
   `prev("new")===null`).
2. `deriveDelay`: `sent` → `done` regardless of date (even far past).
3. `deriveDelay`: missing `pickupOrShipDate` → `on-track` for every stage.
4. `deriveDelay`: now past date + `new`/`baking` → `behind`; same instant
   but `ready`→`on-track`, `sent`→`done`.
5. `deriveDelay`: within 24h (not past) + `new`/`baking` → `due-soon`;
   `ready` in that window → `on-track`.
6. `deriveDelay`: comfortably before date → `on-track`.
7. `summarize`: mixed rows → correct per-stage counts + `behind`/`dueSoon`;
   empty → all zeros.
8. `isAdjacentTransition`: one-step either direction true; jumps and
   same-stage false.

No tests for the page/route/component/GROQ (I/O — consistent with the
codebase testing pure logic only).

## Out of scope

- Customer-facing status / notifications (admin-only for now).
- Member-pick progression.
- Behind-first auto-sorting of the tables (easy follow-up).
- Per-item custom due dates (the drop's single `pickupOrShipDate` is the
  reference).
- The pre-existing order→drop attribution bug (tracked separately as a
  fast-follow).
