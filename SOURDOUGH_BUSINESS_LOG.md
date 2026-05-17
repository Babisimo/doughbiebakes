# Sourdough Business Log: Corona, CA

## Business Profile
- **Location:** Corona, Riverside County, CA
- **Status:** Startup / Home-based
- **Product:** Artisan Sourdough ($10-$15 range)
- **Current Capacity:** 4 loaves per batch (700 sq ft apartment)

## 1. Legal & Regulatory (Riverside County)
- **CFO Class A Registration:** Required for direct sales. No inspection.
- **Home Occupation Permit:** Required by City of Corona.
- **Food Handler Card:** Mandatory within 3 months of starting.
- **Labeling:** Must include "Made in a Home Kitchen," Business Name, Permit #, Ingredients, and Allergens.
- **Sales Limit:** ~$75,000/year (Class A).

## 2. Technical Strategy
- **Framework:** Next.js (TypeScript/JSX)
- **Payments:** Stripe Checkout (Handles PCI compliance/security).
- **CMS:** Sanity.io or similar for easy menu updates.
- **Model:** "Drop-based" inventory to manage oven capacity.
- **Shipping:** Intrastate (California) only. USPS Priority/UPS Ground.

### Build status (started 2026-05-11)
- ✅ Next.js 16 app scaffolded in this folder (App Router, TypeScript, Tailwind v4).
- ✅ **CMS decision: Sanity.io** (over Contentful) — schema-as-code, embedded Studio at `/studio`, generous free tier for a solo founder. Planned with Gemini CLI. Content types: `product` (incl. ingredients/allergens for the CFO label), `drop` (scheduled batch w/ per-flavor quantities), `category`.
- ✅ Stripe Checkout wired: `/api/checkout` (server re-prices cart, US-address, "Local pickup" + "California Priority" shipping options), `/api/webhooks/stripe` (logs order, flags non-CA addresses, decrements the open drop's inventory), `/api/bread-club` (subscription checkout when a recurring Price ID is set).
- ✅ Storefront: home (hero + current drop + menu peek + about), `/menu`, `/product/[slug]` (with ingredients/allergens), `/cart` (localStorage), `/bread-club`, `/order/success`, `/order/canceled`.
- ✅ **Front-end visual identity: "Berry Proof" layout × "Olive Garden Feast" palette** — kept the maximalist/playful kit but recolored from neon to earthy (the neon Berry Proof colors were "too blinding"; switched 2026-05-12, palette picked w/ Gemini's input). **Kit** (unchanged): glassmorphism cards (`backdrop-filter: blur`, `.nb-card`) floating over fixed soft-blurred blobs (`body::before/::after`), squircle radii (~1.75rem cards, pill buttons), bouncy `cubic-bezier(0.34,1.56,0.64,1)` spring hovers (`.nb-interactive`), marquee drop tickers; fonts via `next/font/google` = **Caprasimo** (fat retro display, single 400 weight) + **Plus Jakarta Sans** (body). **Palette** (Olive Garden Feast + one Golden Summer tint): cream `#fefae0` canvas · deep-forest `#283618` ink (AAA on cream) · deepened-terracotta `#a55d1f` primary CTA/accent (`#8a4d18` for links/hover) · olive `#606c38` secondary · soft-sage `#ccd5ae` = "in stock"/"open"/fresh (`.badge-sage`) · ochre `#dda15e` = warm chips/price pills (`.badge-acid`, `bg-ochre`). Gradients: `--grad-acid` "crust" `linear-gradient(135deg,#dda15e,#bc6c25)` (decoration + large display, `.panel-acid`/`.btn` shadows), `--grad-mono` "grove" `(135deg,#606c38,#283618)` (`.panel-mono` + marquee + cream text), `--grad-text` `(120deg,#606c38,#a55d1f)` for clipped gradient text (`.text-grad-acid`/`.text-grad-berry`). Primary/secondary buttons are solid (terracotta/olive + cream text) for AA contrast; gradients live behind large text & decoration only. All in `src/app/globals.css`; fonts in `src/app/layout.tsx`. — Other palettes considered (swap-able by editing those 2 files): pure "Golden Summer Feels" (`#ccd5ae #e9edc9 #fefae0 #faedcd #d4a373` — softest/cottagecore, low contrast); earlier full themes "Acid Artisanal" (bone/black/acid-lime neo-brutalism, Bricolage Grotesque + Space Grotesk) and "Electric Yeast" (dark `#0A0A0A` + electric-mint, Bagel Fat One + Sora).
- ✅ Brand name set to **"Doughbie"** everywhere via `src/lib/site.ts` (`site.name`); also updated Stripe `appInfo`, Sanity Studio title, cart localStorage key, package name. Update `site.email`/`instagram`/`tiktok`/`cottageFood.permitNumber` before launch.
- ✅ Marquee tickers fixed — were rendering static; rewrote to a seamless `display:flex` / `width:max-content` / `translateX(-50%)` loop with hover-to-pause (and still respects `prefers-reduced-motion` — if a user has "reduce motion" on, the ticker is intentionally static).
- ✅ Drop **countdown timers** added — `src/components/countdown.tsx` (hydration-safe ticking DD/HH/MM/SS tiles). Home page shows up to two: one to **orders close** (when the drop is `open`) or **orders open** (when `announced`), and one to the **pickup/ship date**. Each only renders if that date is set on the drop, so e.g. a drop with no `pickupOrShipDate` shows just the first. Also: `getActiveDrop()` now always falls back to `seedDrop()` when there's no usable Sanity drop (was returning `null` if Sanity was configured) — and also falls back if the Sanity drop has zero usable line items — so the home page + countdowns are never empty.
- ✅ **Inventory bug fixes (drop = single source of truth for buyability).** Was: the Menu/product pages let you add a loaf to the cart based only on its `available` toggle, ignoring the drop's per-flavor `quantity` — so a sold-out loaf was still addable from `/menu`; and the cart's quantity selector went 1–12 regardless of stock. Fixed with `src/lib/availability.ts` (`buildAvailability(drop)` → `slug → {canOrder, remaining, reason}`): a loaf is orderable **only** if it's a line item in the **open** drop, that line still has stock, and the product's `available` toggle is on. Menu, product page, home page (drop grid + "from the menu" peek) all show "N left" / "Sold out" / "Not in this drop" / "Coming soon" badges and disable "Add to order" accordingly (with a "See the current drop →" link). `/cart` caps each loaf's qty `<select>` at `remaining`, auto-trims stale over-limit lines, flags any sold-out/off-drop line, and disables checkout until it's removed. **`POST /api/checkout`** is now the authoritative check — it re-validates every cart item against the open drop (in the drop? line still has stock? requested qty ≤ what's left? prices read server-side) and returns `409` otherwise, so a hand-crafted request can't oversell either.
- ✅ **"Notify me" links** on sold-out / off-drop / coming-soon loaves (Menu, product page, home grids) — `src/components/notify-me-link.tsx` + `notifyMeHref()` in `src/lib/site.ts` (a `mailto:` to `site.email` with the loaf name prefilled; replace `site.email` with a real inbox before launch). The demo's `seedDrop()` now shows the Strawberry loaf as sold out so the "Sold out" + "Notify me" states are visible without editing anything.
- ✅ **Bread Club pricing decided** (planned w/ Gemini): **$40 every 4 weeks** for 4 Classic loaves (≈ $10/loaf vs $11 retail — a visible win without gutting margin), every-4-weeks billing not weekly (the fixed 30¢ Stripe fee hits 4× less; "feels" like a membership; quiet no-drop weeks → Stripe pause/skip), value driven mostly by **$0-cost perks** (loaf reserved before the public drop opens, members-only pickup window, always-free local pickup, easy pause/skip, first taste of new flavors), and a hard **~12-member cap** (≈3 batches) so public drops still have loaves — past that it's an email waitlist. Margin floor: never net <~$8.50/club loaf (swap the flavor if an ingredient spikes, don't cut the price). A 2nd tier ("Baker's Choice", any flavor, ~$50/4wk) is a noted follow-up. Display copy lives in `src/lib/site.ts → site.breadClub` (keep in sync with the Stripe Price); `/bread-club` shows it; step-by-step Stripe setup in `docs/STRIPE.md` step 4.
- ✅ **Checkout `shipping_rate_data` fix:** Stripe API `2026-04-22.dahlia` *requires* `type: "fixed_amount"` on each shipping rate — it had been dropped earlier; restored in `src/app/api/checkout/route.ts`. Verified end-to-end: `POST /api/checkout` now returns a real `https://checkout.stripe.com/c/pay/cs_test_…` session; over-quantity / sold-out / off-drop items still get `409`.
- ✅ **Cart-not-clearing-after-checkout fix:** `ClearCartOnMount` (on `/order/success`) was calling `clear()` on mount *before* `CartProvider`'s localStorage-hydration effect ran (child effects fire before parent effects), so the cart got restored right after being cleared. Now it waits for `ready` to flip true, so the clear happens after hydration and persists. (`src/components/clear-cart-on-mount.tsx`.)
- ✅ **`/studio` no longer white-screens when Sanity is unconfigured:** `Studio.tsx` checks `sanityConfigured` and renders a "here's how to turn it on" guide instead of letting `<NextStudio>` throw `Configuration must contain projectId` (which it did because the checkout-demo `.env.local` comments out `NEXT_PUBLIC_SANITY_PROJECT_ID`).
- ℹ️ **Drop inventory only decrements via the Stripe webhook** (`checkout.session.completed` → `applyOrderToActiveDrop`). For it to actually tick down you need all three: live Sanity mode (a real `drop` doc), an **Editor** `SANITY_API_WRITE_TOKEN` (the `sanity_token_api.txt` token is read-only), and the webhook wired (`STRIPE_WEBHOOK_SECRET` + `stripe listen` in dev, or a prod webhook endpoint). In the demo/seed mode the "drop" is a static object regenerated from `seedDrop()` on every request, so it can't visibly decrement no matter what — that's expected, not a bug.
- 🧪 Local checkout simulation (working): `.env.local` (git-ignored) holds the **test-mode** Stripe keys (`sk_test_…`, `pk_test_…`) and temporarily comments out `NEXT_PUBLIC_SANITY_PROJECT_ID` so the storefront uses the bundled demo menu (5 loaves, 4 in stock) instead of the live Sanity content (whose products are all `available: false`). Run `npm run dev` → add loaves → "Pre-order with Stripe ＋" → test card `4242 4242 4242 4242`, any future expiry/CVC, a CA address. Optional: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → `STRIPE_WEBHOOK_SECRET=` to watch inventory decrement + the non-CA flag (the Stripe CLI isn't installed on this machine — `scoop install stripe` or grab the exe). To return to live content: uncomment the three `NEXT_PUBLIC_SANITY_*` lines and restart.
- ⚠️ Live Sanity content notes (project `91s54g5t`): (a) the `drop` doc "Open for Orders" (status `open`) has `ordersCloseAt` set but **`pickupOrShipDate` empty** → the site shows only the "orders close" countdown; set the Pickup/ship date (and a real title) on that Drop in the Studio. (b) **All 3 Sanity `product` docs have `available: false`** (`pepperoni-sourdough`, `classic-sourdough`, `brown-sugar-cinnamon`) → the whole storefront reads "Sold out" even though the drop has stock; flip each product's **Available for ordering** toggle **on** in the Studio. (c) the seed catalog uses different slugs (`classic-country`, `cheddar-jalapeno`, …) than the Sanity products, so `/product/classic-country` etc. fall back to the seed loaf and show "Not in this drop" — harmless, but expect mismatch until the Studio content matches the roadmap.
- ✅ Docs added: `docs/ORDERS.md` (Menu vs. Drop orders — it's one checkout; Menu = always-on catalog, Drop = scheduled inventory-limited subset), `docs/SANITY.md` (CMS: draft→publish, unpublish/delete, weekly drop lifecycle, photos, tokens), `docs/STRIPE.md` (account → test keys → `stripe listen` webhook → test card → Bread Club price → going live). Linked from README.
- ✅ Runs with **zero config** — falls back to a bundled demo menu (`src/lib/seed-products.ts`) and disables checkout until keys are added. `npm run build` + `npm run lint` pass.
- ✅ Sanity project linked: **"Doughbie"** (`91s54g5t`), dataset `production` (public-read). `.env.local` has the `NEXT_PUBLIC_SANITY_*` vars set. `npm run seed:sanity` pushes the starter menu once an Editor token is available.
- ⬜ Sanity TODO: in [manage.sanity.io](https://www.sanity.io/manage/project/91s54g5t) → API, add CORS origin `http://localhost:3000` (allow credentials) so `/studio` works, and create an **Editor** token → put it in `SANITY_API_WRITE_TOKEN` (the token in `sanity_token_api.txt` is read-only). Then add Products + a Drop in the Studio (or run `npm run seed:sanity`).
- ⬜ TODO: add Stripe test keys; upload real photos; set CFO Class A permit # + City of Corona Home Occupation Permit # in `src/lib/site.ts`; confirmation emails (Resend/Postmark); deploy (Vercel).

## 3. Product Roadmap
- **Signature Loaves:** Plain ($10-$12)
- **Inclusions:** 
    - Cheddar/Jalapeño
    - Pepperoni/Garlic
    - Banana/Brown Sugar/Cinnamon
    - Strawberry
- **Marketing:** Random social media posts -> Transition to scheduled "Drop" announcements.

## 4. Expansion Ideas
- **Pre-order System:** Collect payments before baking.
- **Review System:** Integrate Instagram/TikTok social proof.
- **Subscription:** Weekly "Bread Club" for neighbors.

## 5. Equipment & Supplies
### Labeling
- **Primary Labels:** Thermal Printer (Rollo/Munbyn) for 3x3 stickers. Must fit 12pt font "Made in a Home Kitchen" and full ingredient lists.
- **Branding:** Niimbot for small flavor-specific stickers.

### Packaging
- **Local/Market:** Paper bags with windows (6x3x15).
- **Shipping:** Wax paper wrap + vacuum seal or heavy-duty zip-lock + 10x10x6 shipping boxes.

### Production
- **Containers:** 6qt/12qt Cambro containers (vertical storage for small kitchens).
- **Training:** ServSafe California Food Handler Card (Required for sales).
