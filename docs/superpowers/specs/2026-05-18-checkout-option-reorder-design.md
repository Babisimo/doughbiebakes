# Checkout Option Reorder — Design Spec

**Date:** 2026-05-18
**Status:** Approved (pending user spec review)
**Scope:** Single-file presentational change. No route, API, or logic change.

## Goal

The owner's real operating model is verbal order → bake → get paid in person. The cart currently leads with **Stripe pre-order** (primary) and treats **Reserve & pay at pickup** as a secondary afterthought. Flip the emphasis so pay-at-pickup is the default path, while keeping the Stripe path clearly available (it is the **only** path that supports CA shipping / paying online).

## Locked decision

Reserve & pay at pickup = **primary `btn-acid`** button; Pre-order & pay online = **full secondary `btn-outline`** button (not a demoted text link).

## Change

**File:** `src/components/cart-contents.tsx` — only the summary `<aside className="nb-card h-fit space-y-4 p-6">` block (currently ~lines 208–246).

Keep unchanged: `<h2>Summary</h2>`, the subtotal row, the shipping-note `<p>`, the `blockedCount` message, and the `error` `<p>`.

Replace the current CTA order (Stripe `btn-acid` button → caption → gated reserve `btn-outline` Link) with:

1. **Primary** — reserve link, gated exactly as the existing reserve link is (only when `canCheckout`):
   ```tsx
   {canCheckout ? (
     <Link href="/reserve" className="btn-acid w-full justify-center text-sm">
       Reserve &amp; pay at pickup
     </Link>
   ) : null}
   ```
2. Caption `<p>` (reuse existing `text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500` style): **"Local pickup · pay cash or card when you pick up"**
3. **Secondary** — the existing Stripe flow, restyled to outline:
   ```tsx
   <button
     type="button"
     onClick={checkout}
     disabled={submitting || !canCheckout}
     className="btn-outline w-full text-sm"
   >
     {submitting ? "Redirecting…" : "Pre-order & pay online ＋"}
   </button>
   ```
4. Caption `<p>` (same style): **"Pay now with Stripe · needed for California shipping"**

`checkout()`, `/api/checkout`, the `/reserve` route, and `canCheckout`/`submitting` logic are untouched.

## Behavior notes

- When `!canCheckout`: primary reserve link is hidden (parity with today's gated reserve link); secondary Stripe button renders `disabled` (parity with today's gated primary). The existing `blockedCount`/`error` messages already explain why — no new messaging needed.
- The promo-code input from the grand-opening spec (separate doc) will sit **above** these CTAs in the same aside; this spec leaves room for it but does not depend on it. The two specs touch the same aside — implement this one first; the promo spec layers on top.

## Out of scope

Homepage or other entry points; any analytics events (GA4 work is parked on `feat/ga4-analytics`); any change to pricing, routing, or the reserve/checkout APIs.

## Verification

- Cart with in-drop items: "Reserve & pay at pickup" renders as the prominent `btn-acid`, navigates to `/reserve`; "Pre-order & pay online" renders as `btn-outline`, still opens Stripe Checkout.
- Cart containing an item not in the drop (`!canCheckout`): reserve link hidden, Stripe button disabled, blocked message shown.
- `npm run lint` and `npm run typecheck` clean.
