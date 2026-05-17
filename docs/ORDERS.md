# Menu orders vs. Drop orders

**Short version: there is only *one* order system.** Every "Add to order" — whether
the customer clicked it on the **Menu** page or in the **This week's Drop** section
on the home page — drops the item into the same cart and goes through the same
Stripe Checkout. "Menu" and "Drop" are two *views* of your catalog, not two
separate stores.

The difference is **what each view is for** and **what data backs it**.

---

## The Menu (`/menu`)

- **What it is:** your always-on catalog — *everything you ever bake.*
- **Backed by:** every `product` document in Sanity (or, before Sanity is
  connected, the bundled list in `src/lib/seed-products.ts`), grouped by
  `category`.
- **Shows:** name, photo, price, tagline, allergens; each loaf links to a detail
  page with the full **ingredients + allergens** (the Cottage-Food label info).
- **Shows the per-drop count.** Each loaf carries a small corner badge tied to
  the open drop — **"N left"**, **"Sold out"**, **"Not in this drop"**, or
  **"Coming soon"** — so the menu doubles as a live shelf, not just a brochure.
- **"Add to order"** is enabled **only for loaves that are in the open drop with
  stock left** (and the product's **Available for ordering** toggle on). A loaf
  that isn't in this week's drop shows a disabled button + a "See the current
  drop →" link. The open drop is the single source of truth — see below.

Think of the menu as: *"here's everything Doughbie makes — and what you can
grab right now."*

---

## The Drop (`/` → "This week's drop")

- **What it is:** the *scheduled, limited batch that's actually for sale right
  now.* A home oven fits ~4 loaves, so you sell in "drops."
- **Backed by:** the **one** `drop` document whose **status** is `open` (if more
  than one qualifies, the soonest `pickupOrShipDate` wins). If there's no such
  drop in Sanity yet — or Sanity isn't connected — a demo drop comes from
  `seedDrop()` in `src/lib/seed-products.ts`, so the home page (and its
  countdowns) always have something to show until you publish a real one.
- **Shows:** a title, two **live countdowns** (one to *orders close* — or to
  *orders open* if the drop is `announced` — and one to the *pickup/ship date*),
  an optional note, and a grid of `lineItems` — each line is **a product + a
  quantity** (e.g. *Cheddar & Jalapeño ×2*). Each card shows **"N loaves left"**
  or **"Sold out."**
- **"Add to order"** is disabled when any of:
  - that line's `quantity` ≤ 0 → button reads **"Sold out"**, **or**
  - the product's *Available for ordering* is off → **"Sold out"**, **or**
  - the drop's status is `announced` (teased, not open yet) → **"Coming soon"**, **or**
  - the drop's status is `soldout`/`closed` → **"Sold out"**.

Think of the drop as: *"here's what's on the table this weekend, and how much."*

> **The open drop is the single source of truth for what's buyable** — the
> Menu, each product page, the home page, the cart, and the `/api/checkout`
> endpoint all derive availability from it (`src/lib/availability.ts`). A loaf
> that isn't a line item in the open drop simply can't be ordered anywhere; the
> Menu still lists it (with a "Not in this drop" badge) so customers know it
> comes around.

---

## What happens at checkout (same for both)

1. The browser cart is just a list of `{ slug, quantity }` in `localStorage`.
   The `/cart` page caps each loaf's quantity selector at **what's left in the
   drop** and won't let you check out while a sold-out / not-in-drop loaf is in
   the cart.
2. **"Pre-order with Stripe"** → `POST /api/checkout`. The server re-checks
   everything against the **open drop** (the authoritative source): a loaf must
   be a line item in the open drop, that line must still have stock, and you
   can't order more than is left — otherwise you get a `409` and no Stripe
   session. **Prices are read server-side** too (browser amounts are never
   trusted). It then builds a Stripe Checkout Session with your two shipping
   options (free **Local pickup — Corona** and flat-rate **USPS Priority —
   California only**) and redirects to Stripe's hosted page.
3. The customer pays on Stripe. They land on `/order/success`; the cart clears.
4. Stripe calls `POST /api/webhooks/stripe` with `checkout.session.completed`.
   The webhook:
   - logs the order (`[webhook] ✅ Paid order …`),
   - flags a ⚠️ if the shipping/billing state isn't CA (Cottage Food is
     intrastate only — review before fulfilling),
   - **decrements the open drop's `lineItems[].quantity`** for whatever sold,
     and flips the drop to `soldout` if everything hit 0.
     *(This last step needs `SANITY_API_WRITE_TOKEN` set — an Editor token. With
     no token, the webhook just skips it and you close a sold-out drop yourself
     in the Studio.)*

So the **drop** is the only thing with inventory. A "menu order" and a "drop
order" are the same transaction; the drop view just (a) limits what's buyable
and how much, and (b) gets its counts knocked down afterward.

---

## Typical weekly rhythm

1. In the Studio, create a new **Drop** (status `draft`) → add this weekend's
   loaves as line items with quantities → set the **order-by** and **pickup**
   dates.
2. Flip it to **`announced`** to tease it ("dropping soon"), then **`open`** when
   you want orders to start. *(Keep only one drop `open` at a time.)*
3. Orders come in; quantities tick down automatically (or you adjust them by
   hand). When it's empty it shows **Sold out** / flips to `soldout`.
4. After you've baked and handed everything off, set the drop to **`closed`**.
5. Next week: new Drop. Old products stay on the **Menu** the whole time — the
   menu doesn't change just because a drop opened or closed, but "Add to order"
   only lights up for whatever's in the **new** drop.

> **Heads-up:** if your storefront looks "all sold out," check the products in
> the Studio — each one has an **Available for ordering** toggle that must be
> **on**, *and* the loaf has to be a line item (with `quantity > 0`) in the
> drop whose status is `open`. A loaf with the toggle off shows "Sold out" even
> if the drop says it has stock.

---

## Possible tweaks (ask and I'll wire them up)

- **"Notify me" instead of "Sold out"** for off-drop loaves: swap the disabled
  button for an email/Instagram link so people can ask to be told when it's back.
- **Hide off-drop loaves from the Menu entirely** (only ever show what's in the
  open drop) — even more minimal than today.
- **Per-loaf countdown on each drop card** ("closes in 3h 12m").
- **Auto-flip the drop to `soldout`** the moment the last loaf is reserved at
  checkout (today it flips after the webhook confirms payment).
