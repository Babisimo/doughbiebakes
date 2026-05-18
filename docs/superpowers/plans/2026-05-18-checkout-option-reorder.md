# Checkout Option Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Reserve & pay at pickup" the primary cart CTA and demote Stripe pre-order to a full secondary button.

**Architecture:** A single presentational edit to the summary `<aside>` in `src/components/cart-contents.tsx`. No route, API, pricing, or state-logic change. The reserve path stays a `<Link href="/reserve">`; the Stripe path stays the existing `checkout()` handler.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4. No React component test harness exists in this repo (tests are `node:test` for pure functions only), so verification for this presentational change is `npm run lint` + `npm run typecheck` + a defined manual check — matching the project's conventions rather than inventing a harness.

**Spec:** `docs/superpowers/specs/2026-05-18-checkout-option-reorder-design.md`

---

### Task 1: Reorder the cart CTAs

**Files:**
- Modify: `src/components/cart-contents.tsx` (the summary `<aside>` block, currently lines ~227–245)

- [ ] **Step 1: Apply the edit**

In `src/components/cart-contents.tsx`, find this exact block inside `<aside className="nb-card h-fit space-y-4 p-6">`:

```tsx
        <button
          type="button"
          onClick={checkout}
          disabled={submitting || !canCheckout}
          className="btn-acid w-full text-sm"
        >
          {submitting ? "Redirecting…" : "Pre-order with Stripe ＋"}
        </button>
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          Pre-order from a home kitchen · we email to confirm pickup/shipping
        </p>
        {canCheckout ? (
          <Link
            href="/reserve"
            className="btn-outline w-full justify-center text-sm"
          >
            Or reserve &amp; pay at pickup (local only)
          </Link>
        ) : null}
```

Replace it with (reserve becomes primary `btn-acid`, Stripe becomes secondary `btn-outline`):

```tsx
        {canCheckout ? (
          <Link
            href="/reserve"
            className="btn-acid w-full justify-center text-sm"
          >
            Reserve &amp; pay at pickup
          </Link>
        ) : null}
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          Local pickup · pay cash or card when you pick up
        </p>
        <button
          type="button"
          onClick={checkout}
          disabled={submitting || !canCheckout}
          className="btn-outline w-full text-sm"
        >
          {submitting ? "Redirecting…" : "Pre-order & pay online ＋"}
        </button>
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          Pay now with Stripe · needed for California shipping
        </p>
```

Nothing else in the file changes. `checkout`, `submitting`, `canCheckout`, and the `Link` import are already present and unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no errors).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. With at least one in-drop loaf in the cart, open `/cart`:
- Expected: "Reserve & pay at pickup" renders as the prominent (acid) button and links to `/reserve`; "Pre-order & pay online ＋" renders below it as an outline button and still opens Stripe Checkout when clicked.
- Add a loaf not in the current drop (so `!canCheckout`): expected the reserve link is hidden, the Stripe button is disabled, and the existing "Remove the loaf…" blocked message shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/cart-contents.tsx
git commit -m "feat: make reserve-&-pay-at-pickup the primary cart CTA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** Spec requires reserve = primary `btn-acid`, Stripe = full secondary `btn-outline`, rewritten captions, gating parity, no logic change → Task 1 covers all. ✅
- **Placeholders:** none. ✅
- **Type consistency:** no new types; uses existing `checkout`/`submitting`/`canCheckout`/`Link`. ✅
