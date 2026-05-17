# Doughbie — storefront

A small e-commerce site for **Doughbie**, a home-based California Cottage Food
sourdough bakery in Corona, CA: a "drop"-based menu, Stripe Checkout pre-orders,
an optional weekly Bread Club subscription, and a headless CMS for the menu.

**Guides:** [`docs/ORDERS.md`](docs/ORDERS.md) — how Menu vs. Drop orders work ·
[`docs/SANITY.md`](docs/SANITY.md) — using the CMS (draft → publish, unpublish,
drops) · [`docs/STRIPE.md`](docs/STRIPE.md) — setting up payments.

- **Framework:** Next.js 16 (App Router, TypeScript) + Tailwind CSS v4
- **Look:** "Berry Proof" kit on an "Olive Garden Feast" (earthy) palette —
  maximalist & playful: glassmorphism cards over soft blurred blobs, squircle
  radii, bouncy spring hovers, fat retro display font (Caprasimo) + Plus
  Jakarta Sans body — recolored to warm cream `#fefae0` / deep-forest `#283618`
  ink / terracotta `#a55d1f` accent / olive + ochre + sage, with juicy-but-not-
  neon "crust"/"grove" gradients. Theme tokens + reusable classes (`.nb-card`,
  `.btn-acid`/`.btn-ink`, `.badge`/`.badge-acid`/`.badge-flame`/`.badge-sage`,
  `.panel-acid`/`.panel-mono`, `.text-grad-acid`/`.text-grad-berry`,
  `.nb-interactive`, `.marquee`, …) are in `src/app/globals.css`; fonts are
  loaded in `src/app/layout.tsx`. (Alternate palettes/themes considered —
  "Golden Summer Feels", "Acid Artisanal" neo-brutalism, "Electric Yeast"
  dark+neon — are documented in `SOURDOUGH_BUSINESS_LOG.md` and swap in by
  editing those two files.)
- **Payments:** Stripe Checkout (hosted) + webhooks
- **CMS:** Sanity.io — embedded Studio at `/studio`
- **Runs with zero config:** without Stripe/Sanity keys it serves a bundled
  demo menu (`src/lib/seed-products.ts`) and shows a clear notice on checkout.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in keys when you have them — all optional
npm run dev
```

Open <http://localhost:3000>. Other scripts: `npm run build`, `npm run start`,
`npm run lint`, `npm run typecheck`.

## Connecting Sanity (the menu CMS)

The project ("Doughbie", id `91s54g5t`, dataset `production`) is already linked
in `.env.local`. Allow the embedded Studio to talk to Sanity once
(`npx sanity cors add http://localhost:3000 --credentials`, or via
[manage.sanity.io](https://www.sanity.io/manage/project/91s54g5t/api)), then
`npm run dev` and open <http://localhost:3000/studio>.

Content types (`Product`, `Drop`, `Category`) are defined in
`src/sanity/schemaTypes/`. **Full walkthrough — draft → publish, unpublishing,
running weekly drops, photos, tokens — is in [`docs/SANITY.md`](docs/SANITY.md).**
`npm run seed:sanity` loads the demo menu (needs an Editor token in
`SANITY_API_WRITE_TOKEN`).

## Connecting Stripe

Test keys → `.env.local` → `stripe listen --forward-to
localhost:3000/api/webhooks/stripe` → test card `4242 4242 4242 4242`.
**Step-by-step (account, keys, webhooks, the Bread Club price, going live) is in
[`docs/STRIPE.md`](docs/STRIPE.md).**

Order flow: cart (localStorage) → `POST /api/checkout` re-prices items
server-side and creates a Checkout Session (US address, `Local pickup` +
`California Priority` shipping options) → Stripe hosted page →
`checkout.session.completed` webhook logs the order, flags any out-of-state
address, and decrements the open drop's inventory (needs
`SANITY_API_WRITE_TOKEN`). See [`docs/ORDERS.md`](docs/ORDERS.md) for how the
Menu and the Drop relate.

## Cottage Food (California, Class A) notes baked in

- "Made in a Home Kitchen", business name, permit #, ingredients and allergens
  surface on each product page and the footer — edit text in `src/lib/site.ts`.
- Checkout collects a US shipping address and warns that orders ship within
  California only; the webhook flags non-CA addresses for manual review. (Stripe
  Checkout can't hard-restrict to a single state — review before fulfilling.)
- Update `site.cottageFood.permitNumber` once your CFO Class A registration and
  City of Corona Home Occupation Permit numbers are issued.

## Project layout

```
src/
  app/
    page.tsx                  home (hero, current drop, menu peek, about)
    menu/                     full menu, grouped by category
    product/[slug]/           product detail + ingredients/allergens
    cart/                     cart + "pre-order with Stripe"
    bread-club/               weekly subscription / waitlist
    order/success, order/canceled
    studio/[[...tool]]/       embedded Sanity Studio (client-only)
    api/checkout, api/bread-club, api/webhooks/stripe
  components/                 header, footer, cart provider, product cards, …
  lib/                        catalog (Sanity-or-seed), stripe, site config, types, money
  sanity/                     env, client, image, schemaTypes, queries, mutations
sanity.config.ts / sanity.cli.ts   Studio + CLI config
docs/                         ORDERS.md · SANITY.md · STRIPE.md
scripts/seed-sanity.mjs       `npm run seed:sanity` — load the demo menu into Sanity
```

## Deploying

Deploys cleanly to Vercel. Set the env vars from `.env.example` in the project
settings, set `NEXT_PUBLIC_SITE_URL` to your domain, and add a Stripe webhook
endpoint pointing at `https://<domain>/api/webhooks/stripe`.
