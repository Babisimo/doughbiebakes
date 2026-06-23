# Fourth of July Flash Sale — Campaign Design

**Date:** 2026-06-23
**Status:** Approved (brainstorm) → ready to produce content
**Depends on:** the shipped flash-sales feature
(`2026-06-23-flash-sales-design.md`). This campaign *uses* that engine; it adds
no code to the discount/storefront machinery.

## Goal

Drive pre-orders for a Fourth of July drop by promoting a time-boxed 15% flash
sale on Instagram, aimed at party hosts who need something to bring. Honest
urgency comes from a real deadline: the baker leaves town Fri Jul 3, so the
holiday batch must be ordered, baked, and delivered before then.

## Campaign angle

Lean into the **250th** (America's semiquincentennial) — July 4, 2026 is a
Saturday and the once-in-a-lifetime "America 250" Fourth.

- **Lead:** "The biggest Fourth of our lifetime deserves better than
  store-bought."
- **Scarcity close (authentic):** "This is my last batch before I'm out of town
  for the holiday weekend — order by Monday."
- **Make-ahead reassurance:** bread is delivered Jul 1–2 for a Jul 4 party, so
  every piece of copy carries a one-line serving tip: "refresh 10 min in a 350°
  oven and the crust comes right back." Turns the only objection (2–3 days
  ahead) into a useful tip.

## Offer & mechanics

A **drop-wide 15% flash sale** on the "Fourth of July Drop" (slug
`fourth-of-july-drop`), run entirely through the existing engine — no manual
discounting.

**Exact drop values to set in Studio (the drop is currently a Draft):**

| Field | Value |
|---|---|
| Status | **Open for orders** (publish the draft) — or "Announced" to auto-open at `ordersOpenAt` |
| `ordersOpenAt` | `2026-06-24 08:00` |
| `ordersCloseAt` | `2026-06-29 12:00` (Mon noon) |
| `pickupOrShipDate` | **`2026-07-02`** (was empty — hand-delivery day) |
| Note to customers | "Free local hand-delivery in the Corona area, Jul 1–2. Last batch before the holiday." |

**Flash sale sub-fields:**

| Field | Value |
|---|---|
| `enabled` | **`true`** (confirm the toggle is on) |
| `percentOff` | `15` |
| `startsAt` | *(blank — live the moment enabled)* |
| `endsAt` | **`2026-06-29 12:00`** — MUST equal `ordersCloseAt` so the countdown banner matches the real deadline (draft had Jun 30 13:00, which would mislead) |
| `headline` | `America's 250th — order by Mon 6/29` |

**Why `endsAt` must equal `ordersCloseAt`:** `flashSaleStatus` returns active
only while `effectiveDropStatus === "open"`. Once `ordersCloseAt` passes (Mon
noon) the drop is closed and the discount stops — but the banner's countdown
reads `flashSale.endsAt`. If `endsAt` is later than the close, the banner ticks
toward a time when ordering is already shut. Align them.

On-site, the countdown banner + struck-through prices sell automatically;
Instagram's only job is to drive traffic to the site.

## Timeline (2026)

| Date | Day | Event |
|---|---|---|
| Jun 23 | Tue | Today (planning) |
| Jun 24 | Wed | Sale enabled in Studio + **launch carousel** posted |
| Jun 25–28 | Thu–Sun | Story rotation (countdown + one hero loaf/day + serving tip) |
| Jun 28 | Sun | "24 hours left" story |
| **Jun 29** | **Mon** | **Orders close EOD** + "LAST CALL" feed post & story |
| Jul 1–2 | Wed–Thu | Bake + deliver/pickup |
| Jul 3 | Fri | Baker leaves for Arizona |
| Jul 4 | Sat | The 250th Fourth |

## Hero products (actual Fourth of July Drop lineup)

All four loaves get 15%; here's how each is framed. **Small batch — 12 loaves
total** (Pepperoni ×4, Jalapeño Cheddar ×4, Classic ×2, Banana Chocolate Chip
×2) — so genuine scarcity ("when they're gone, I'm already on the road") runs
through the copy, with the Classic and Banana Chocolate Chip as the scarcest
(2 each).

- **Jalapeño Cheddar Sourdough** — savory cookout hero; toasts into a grilled
  cheese on its own; great for sliders/burgers.
- **Pepperoni Sourdough** — "pizza night in loaf form," tear-and-share crowd
  snack, no sauce needed.
- **Classic Sourdough** — the do-anything base: crostini, dips, burger buns,
  the cheese-board centerpiece.
- **Banana Chocolate Chip** — the sweet one: dessert + the kid-pleaser + Fourth-
  of-July-morning toast.

(No Strawberry in this drop — the literal red-loaf angle is dropped; the
red-white-&-blue framing stays at the table/spread level, not a single loaf.)

## Channels

**Instagram only** (feed + stories). No email/LinkedIn/SMS this round.

## Deliverables (what gets produced at implementation)

1. **Launch carousel** — caption + slide-by-slide text (≈5 slides: hook → offer
   → hero loaves → how-to-serve → deadline/CTA).
2. **Story frame scripts** — 5–6 frames: countdown-sticker frame, one per hero
   loaf with a serving tip, a "24 hours left" frame.
3. **Last-call feed post** — short, urgent, "closes tonight."
4. **Hashtag + location set** — local (Corona/Inland Empire) + Fourth/250th tags.
5. **Exact Sanity `flashSale` values** — the table above, ready to paste.
6. **Serving-tip sheet** — the make-ahead/refresh suggestions referenced in copy,
   so captions stay consistent.

All copy must:
- Carry the **order-by Mon Jun 29 (noon)** deadline and the **"I'll hand-deliver
  Jul 1–2, before I leave town"** framing consistently (no contradictory dates).
- Use **free local hand-delivery** wording ("I'll drop it to your door in the
  Corona area"), **not** "pickup" — the baker delivers this round.
- Lean on the **real scarcity**: just 2 of each loaf, 8 total.
- Include the **350° refresh tip** wherever a "fresh for your party" expectation
  could otherwise be set.
- Drive to the **site** (where the auto-discount + countdown live) — "order at
  the link in bio."
- Stay true to the **Cottage Food** voice (home kitchen, made to order, local
  to the Corona area).

## Out of scope

- Email / LinkedIn / SMS content (IG-only this round).
- Any change to the flash-sale code (the engine already shipped).
- Paid ads.
- A reusable annual template (this is a one-off; the 250th hook doesn't repeat).
