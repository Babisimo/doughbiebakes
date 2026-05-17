# How to set up Stripe (payments for Doughbie)

Stripe runs the **checkout** (their hosted page — so card data never touches your
site or server; PCI is their problem, not yours) and notifies your app when an
order is paid (a **webhook**). The site works *without* Stripe — checkout just
returns a polite "payments aren't configured yet" — so you can wire this up when
you're ready.

Everything below uses **Test mode** first. Stripe has a **Test mode / Live mode**
toggle in the top bar of the dashboard; test keys start with `sk_test_…` /
`pk_test_…` and use fake cards. Switch to Live only when you're actually open.

---

## The env vars (all go in `.env.local`)

| Variable | What it is | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Your site's URL (used for Stripe redirect URLs) | `http://localhost:3000` in dev; your real domain in prod |
| `STRIPE_SECRET_KEY` | Server-side API key | Dashboard → Developers → **API keys** → "Secret key" |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public key (safe to expose) | same page → "Publishable key" |
| `STRIPE_WEBHOOK_SECRET` | Signs incoming webhook events so you know they're real | `stripe listen` prints it (dev) / the webhook endpoint's "Signing secret" (prod) |
| `STRIPE_BREAD_CLUB_PRICE_ID` | *(optional)* the recurring Price for the weekly subscription | Dashboard → Products → your "Bread Club" product → the **Price ID** (`price_…`) |

`.env.example` has all of these with comments. After editing `.env.local`,
**restart `npm run dev`** (env vars are read at startup).

---

## Step 1 — Account + test API keys

1. Create a Stripe account (or log in) at <https://dashboard.stripe.com>.
2. Make sure **Test mode** is ON (toggle, top-right).
3. **Developers → API keys.** Copy the **Publishable key** and the **Secret
   key**.
4. Put them in `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_xxx
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
5. Restart `npm run dev`. The cart's **"Pre-order with Stripe"** button now
   actually goes to Stripe. (You won't get order notifications yet — that's the
   webhook, next.)

---

## Step 2 — Webhook (so the app hears "order paid")

When someone pays, Stripe POSTs an event to `/api/webhooks/stripe`. Your app
verifies the signature, logs the order, flags non-California addresses, and
decrements the open drop's inventory in Sanity. To make that work locally you
forward Stripe's events to your dev server:

1. Install the Stripe CLI: <https://stripe.com/docs/stripe-cli> (`brew install
   stripe/stripe-cli/stripe`, `scoop install stripe`, or download the binary).
2. `stripe login` (one-time, opens a browser).
3. In a separate terminal, with `npm run dev` running:
   ```
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
4. It prints a line like `Ready! Your webhook signing secret is whsec_abc123…`.
   Copy that into `.env.local`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_abc123...
   ```
5. **Restart `npm run dev`.** Leave `stripe listen` running while you test.

---

## Step 3 — Run a test order

1. With both terminals running, open `http://localhost:3000`, add a loaf, go to
   the cart, click **Pre-order with Stripe**.
2. On Stripe's page use a **test card**:
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date · CVC: any 3 digits · ZIP: any 5 digits
   - (Other test cards: `4000 0000 0000 9995` = declined, `4000 0025 0000 3155`
     = requires authentication. Full list: <https://stripe.com/docs/testing>.)
3. After paying you land on `/order/success` and the cart clears.
4. Watch your terminals:
   - `stripe listen` shows `checkout.session.completed` forwarded.
   - the `npm run dev` log shows `[webhook] ✅ Paid order cs_test_… — $X.XX — …`
     (and a `⚠️` line if the shipping state wasn't CA).
5. If you've set `SANITY_API_WRITE_TOKEN`, the open drop's quantities in the
   Studio will have dropped by what you "bought".

That's the whole order flow working.

---

## Step 4 — (Optional) the Bread Club subscription

The `/bread-club` page shows an **email waitlist** until you create a recurring
price; once you do, it shows a real **"Join the Bread Club"** button that starts
a Stripe subscription Checkout.

**Recommended price: $40.00 every 4 weeks** (≈ $10/loaf for four Classic loaves
— a visible win vs $11 retail without eating your margin; the every-4-weeks
cadence beats weekly because the fixed 30¢ Stripe fee hits 4× less often and a
~monthly charge "feels" like a membership). The display copy on `/bread-club`
(price, "every 4 weeks", per-loaf, seats) lives in `src/lib/site.ts` →
`site.breadClub` — **keep it in sync with the Stripe Price below.**

1. Dashboard → **Product catalog → Add product.** Name it "Bread Club"
   (description, image optional).
2. Under **Pricing**: **Recurring**, billing period **Custom → every 4 weeks**,
   amount **$40.00**. Save. *(Want the second tier from the plan — "Baker's
   Choice", any flavor, $50/4 weeks? Add a second price; wiring the page to
   offer two tiers is a small follow-up — ask.)*
3. Click into that price → copy its **API ID** (`price_…`).
4. `.env.local`:
   ```
   STRIPE_BREAD_CLUB_PRICE_ID=price_xxx
   ```
5. Restart `npm run dev`. The Bread Club page now offers sign-up; the customer
   manages/cancels (and pauses/skips) via Stripe's customer portal link in
   their receipt.
6. **Cap it:** stop signups around **12 members** (~3 batches) so public drops
   still have loaves. The page already says "{n} spots" and falls back to the
   waitlist email — just don't raise `site.breadClub.seats` past what your oven
   can cover, and close the Stripe Price (Archive) once you're full.

---

## Cottage Food note (important)

California Cottage Food sales must stay **in-state**. Stripe Checkout can collect
a shipping address but **can't restrict it to a single state**, so:
- Checkout collects a **US** address and the page warns "California addresses
  only — choose Local Pickup if you're in the Corona area."
- The webhook **logs a ⚠️** when an order's shipping/billing state isn't `CA`.
- **Review every order before fulfilling.** If a non-CA order slips through,
  refund it (or arrange local pickup) from the Stripe dashboard.

---

## Going live

1. Flip the dashboard to **Live mode**. Complete Stripe's **business details /
   bank account** activation (required before you can take real money).
2. **Developers → API keys** (live) → put the live `sk_live_…` / `pk_live_…` in
   your host's environment (Vercel project settings, etc.) — **not** in the repo.
3. Set `NEXT_PUBLIC_SITE_URL=https://yourdomain.com` in the host env.
4. **Developers → Webhooks → Add endpoint:**
   - URL: `https://yourdomain.com/api/webhooks/stripe`
   - Events: at minimum **`checkout.session.completed`** (add
     `customer.subscription.*` if you later expand the Bread Club handling).
   - After creating it, copy the endpoint's **Signing secret** (`whsec_…`) into
     your host env as `STRIPE_WEBHOOK_SECRET` (this is the *live* one — different
     from the `stripe listen` one).
5. (Optional) Turn on **Stripe Tax** if you need to collect sales tax, set up
   **email receipts**, your **statement descriptor** ("DOUGHBIE"), payout
   schedule, etc., all in the dashboard.
6. Do one real low-value live test order, confirm the webhook fires, then refund
   yourself.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Turn payments on (dev) | Put test `sk_test_`/`pk_test_` keys in `.env.local` → restart `npm run dev` |
| Get order notifications (dev) | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → copy `whsec_` into `.env.local` → restart |
| Test a purchase | Card `4242 4242 4242 4242`, any future expiry/CVC/ZIP |
| Enable the Bread Club | Create a recurring Price (rec: **$40 every 4 weeks**) → put its `price_…` in `STRIPE_BREAD_CLUB_PRICE_ID`; keep `site.breadClub` in sync |
| See an order | Dashboard → **Payments**; your dev terminal logs `[webhook] ✅ Paid order …` |
| Refund / handle a dispute | Dashboard → Payments → the payment → **Refund** |
| Go live | Activate account → live keys in host env → add live webhook endpoint → set `NEXT_PUBLIC_SITE_URL` |
| Change prices on the site | You don't do this in Stripe — prices live in Sanity (`priceCents` on each Product). Stripe just charges what the server sends. |
