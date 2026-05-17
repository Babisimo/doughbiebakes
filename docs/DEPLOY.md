# Deploy runbook

Step-by-step from "works on my laptop" to "live on the internet." Written for two phases:

1. **Pre-launch on Vercel Hobby** — free, perfect for testing with you + a couple friends. Vercel's Terms forbid commercial use, so this is a *staging* deployment, not a real launch.
2. **Public launch** — move to a commercial-OK host (Cloudflare Pages free, or Vercel Pro at $20/mo) once you're ready to accept money from strangers. See the **"Going live"** section at the bottom.

---

## Phase 1 — Pre-launch deploy to Vercel Hobby

### 0. Make sure the code is on GitHub

Vercel deploys from a Git repo. If you don't already have one:

```powershell
gh repo create doughbie-app --private --source=. --remote=origin --push
```

(Or create the repo through github.com → push your branch.)

### 1. Create a Vercel account

- Go to https://vercel.com/signup
- Sign in with GitHub (matches the repo you just made)
- You'll land on a "Import Git Repository" page

### 2. Import the project

- Pick `doughbie-app` (or whatever you named the repo)
- Vercel auto-detects Next.js — leave Build Command and Output Directory at defaults
- **Don't** click Deploy yet — env vars first

### 3. Add env vars

Open `.env.local` on your machine. For every line below, copy the value into Vercel:

**Vercel dashboard → your project → Settings → Environment Variables → Add.**

Set each one for **Production, Preview, and Development**. (Vercel lets you toggle which environments each var applies to. For simplicity, apply to all three.)

| Var | Value source | Required? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://<your-project>.vercel.app` (replace later with your domain) | Yes | Used in Stripe redirect URLs and emails |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | `91s54g5t` (your current value) | Yes — for live menu | Or leave blank to run on seed data |
| `NEXT_PUBLIC_SANITY_DATASET` | `production` | Yes | |
| `NEXT_PUBLIC_SANITY_API_VERSION` | `2025-01-01` | Yes | |
| `SANITY_API_WRITE_TOKEN` | Editor token from `sanity.io/manage/project/91s54g5t/api` | Yes — for member selections + inventory decrement | Treat as a password |
| `STRIPE_SECRET_KEY` | Test key (`sk_test_...`) for pre-launch | Yes | Switch to `sk_live_...` only for real launch |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matching test publishable (`pk_test_...`) | Yes | |
| `STRIPE_WEBHOOK_SECRET` | Created in step 5 below | Yes | Leave blank during first deploy; come back after step 5 |
| `STRIPE_BREAD_CLUB_PRICE_ID` | `price_1TWmziBW5QH5WgoACRS11ly7` (your current test price) | Yes — for Bread Club | |
| `CLUB_LINK_SECRET` | The 64-char hex from `.env.local` | Yes | Same value here as locally — otherwise magic-links generated on your laptop won't verify on Vercel |
| `BAKER_TOKEN` | The 48-char hex from `.env.local` | Yes — for `/admin/club` | You can rotate this any time |
| `RESEND_API_KEY` | `re_...` from resend.com | Yes — for confirmation emails | |
| `FROM_EMAIL` | `Doughbie <onboarding@resend.dev>` until you verify a domain | Yes | Update to your domain sender once verified |

### 4. First deploy

Click **Deploy**. Build takes 1–2 minutes. When it's green you'll get a URL like `https://doughbie-app.vercel.app`.

Smoke-test:

- `/` — home page loads, drop visible (or seed data fallback)
- `/menu` — products show
- `/cart` — empty cart message
- `/bread-club` — page loads, **Join the club** button is present (because `STRIPE_BREAD_CLUB_PRICE_ID` is set)
- `/admin/login` — login form renders; submit with the wrong token → "wrong token"; submit with the right one → bounces to `/admin/club`

### 5. Wire up Stripe webhooks

The local `stripe listen` approach doesn't work in production — the webhook needs a permanent public URL.

1. **Stripe dashboard** (test mode) → Developers → Webhooks → **Add endpoint**
2. **Endpoint URL**: `https://<your-vercel-url>/api/webhooks/stripe`
3. **Events to send**: at minimum
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. After saving, copy the **Signing secret** (starts with `whsec_…`)
5. Paste it into Vercel env var `STRIPE_WEBHOOK_SECRET`
6. **Redeploy** so the new env var takes effect (Vercel → Deployments → ⋯ → Redeploy)

### 6. Wire up Sanity CORS

Sanity blocks browser requests from any origin not on its allow-list.

1. Go to https://manage.sanity.io/project/91s54g5t/api/cors
2. **Add CORS origin** → paste `https://<your-vercel-url>`
3. ✅ "Allow credentials" can stay unchecked (we use API tokens, not cookies)
4. (Repeat later for your custom domain)

### 7. Final pre-launch smoke test

Pretend you're a customer and walk through it:

- **Public buyer:** open the site → add a loaf → checkout with `4242 4242 4242 4242` (Stripe test card)
- **Bread Club subscriber:** `/bread-club` → Join the club → check out same way
- **Magic link:** run `npm run club:link -- your-test-email@gmail.com` **locally** (pointing at your laptop, since the script uses `.env.local`). Visit the printed URL, but **change the host from `localhost:3000` to your Vercel URL**. Pick a flavor → Confirm → check inbox for the email.
  - To run the script against Vercel directly, change `NEXT_PUBLIC_SITE_URL` in `.env.local` to your Vercel URL temporarily, then re-run.
- **Bake list:** visit `https://<your-vercel-url>/admin/login`, log in, see the bake list.

If all four work, you're deployed.

### 8. Subsequent deploys

Every `git push` to your `main` branch auto-deploys to production. Branches push as previews (separate URLs). Rollback via Deployments → ⋯ → Promote to production.

---

## Adding your custom domain (when you grab `doughbie.bakery`)

Once you've bought the domain (whichever registrar — Cloudflare, Porkbun, etc.):

### 1. Add the domain in Vercel

- Vercel dashboard → your project → Settings → Domains → **Add**
- Type `doughbie.bakery` and click Add
- Vercel shows you DNS records to set up

### 2. Set the DNS records at your registrar

Typically Vercel asks for either:
- An **A record** at `@` pointing to `76.76.21.21`, and a **CNAME** at `www` pointing to `cname.vercel-dns.com`
- Or **nameserver delegation** to Vercel

Use whichever your registrar makes easier. Wait 1–30 minutes for DNS propagation.

### 3. Update env vars

- Change `NEXT_PUBLIC_SITE_URL` to `https://doughbie.bakery`
- Redeploy

### 4. Update the Stripe webhook URL

- Stripe dashboard → Developers → Webhooks → click your endpoint → **Update**
- Change URL to `https://doughbie.bakery/api/webhooks/stripe`
- Signing secret stays the same — no env var change needed

### 5. Update Sanity CORS

- Add `https://doughbie.bakery` to the CORS origins list (don't delete the old `*.vercel.app` entry — useful for preview deploys)

### 6. Verify the domain in Resend

So you can email real members, not just yourself:

- Resend dashboard → Domains → **Add Domain** → enter `doughbie.bakery` (or `mail.doughbie.bakery` if you want a subdomain)
- Resend prints DKIM + SPF + DMARC records — add them at your registrar's DNS
- Wait for Resend to flip the status to **Verified** (usually <1 hour)
- Update `FROM_EMAIL` in Vercel env vars to e.g. `Doughbie <hello@doughbie.bakery>`
- Redeploy

---

## Going live (taking real money)

Mental model: **Stripe test mode and live mode are separate data universes.** Switching to live keys gives you an empty Stripe slate automatically — there's nothing to "delete" there. The data that needs manual cleaning is **Sanity**, because your test selections / cached members / test drops live in the *same* `production` dataset the real site uses.

### 0. Wipe the test data so launch starts at zero

Do this in Sanity Studio (`/studio`) — for the handful of test docs, deleting by hand is safest because you see exactly what's going. Delete:

- **Every `Member` doc** — these were cached from *test-mode* Stripe webhooks. Live subscribers get new Stripe customer ids and fresh docs; stale test ones would inflate the 12-seat count and `club:emails`.
- **Every `Member selection` doc** — test picks.
- **Every test `Drop`** (e.g. "Open for Orders") — or set to `draft`. You'll create the real first drop fresh.

**Keep** your `Product` and `Category` docs — that's your real curated menu (just verify names, slugs, prices, photos, allergens are final; confirm the Classic loaf's slug is exactly `classic` so the default-to-Classic feature works).

Bulk alternative (if there are many): `npx sanity documents query '*[_type in ["member","memberSelection"]]._id'` to list ids, then `npx sanity documents delete <id> <id> …`. Don't `sanity dataset` wipe — that nukes your real products too.

There is **no** local data to reset (cart is per-browser localStorage; nothing else persists locally).

### 0b. Rotate secrets for production

Several secrets were generated/handled during dev. For a public site, generate fresh ones and set them **only** in the host's env vars (never commit, never paste in chat):

- `CLUB_LINK_SECRET` — new 32-byte hex. (Rotating invalidates every old magic link, which is what you want — no test links should work in prod.)
- `BAKER_TOKEN` — new 24-byte hex.
- `SANITY_API_WRITE_TOKEN` — create a fresh Editor token in Sanity, revoke the old one.
- `RESEND_API_KEY` — create a fresh key in Resend, revoke the dev one.
- Stripe keys become live keys anyway (step B).

### A. Move off Vercel Hobby

Vercel's Hobby plan is non-commercial only. Pick one:

- **Cloudflare Pages (free, commercial-OK):**
  1. Sign up at https://pages.cloudflare.com
  2. Connect your GitHub repo
  3. Install the `@opennextjs/cloudflare` adapter — see https://opennext.js.org/cloudflare for current setup steps (the project may have evolved since this doc was written; check the docs)
  4. Copy the env vars over from Vercel
  5. Deploy
  6. Re-point your domain's DNS to Cloudflare Pages
  7. Update the Stripe webhook URL again
- **Vercel Pro ($20/mo):**
  1. Project Settings → Billing → Upgrade to Pro
  2. No code or env changes needed — same workflow, just paid

### B. Switch Stripe to live mode

- Stripe dashboard → toggle to **Live mode** (top right)
- Create a **new** Bread Club product/price in live mode (test prices don't carry over)
- Create a **new** webhook endpoint pointing at your production URL
- Update these env vars to live values:
  - `STRIPE_SECRET_KEY` → `sk_live_...`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `pk_live_...`
  - `STRIPE_WEBHOOK_SECRET` → new `whsec_...` from the live webhook
  - `STRIPE_BREAD_CLUB_PRICE_ID` → the new `price_...` from live mode

### C. Final checklist before announcing publicly

- [ ] Test data wiped (step 0) — `/admin/club` shows 0 members, `/bread-club` shows full 12 seats
- [ ] Secrets rotated (step 0b) and set in the **host's** env vars, not `.env.local`
- [ ] `NEXT_PUBLIC_SITE_URL` = your real `https://` domain
- [ ] Production domain added to Sanity CORS (`manage.sanity.io/project/91s54g5t/api/cors`)
- [ ] One **real first Drop** created in Studio: status `draft` until you're ready, real loaf line items + true bake quantities, `ordersOpenAt` / `ordersCloseAt` / `pickupOrShipDate` set
- [ ] Live Stripe webhook points at `https://<domain>/api/webhooks/stripe` with events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`
- [ ] Visit a couple of product pages and add to cart — full Stripe Checkout flow works with real card
- [ ] Bread Club signup → real card → confirmation email lands in your inbox
- [ ] `/admin/club` shows the subscriber with name + shipping address
- [ ] Run `npm run club:emails` against an announced drop → real magic links print
- [ ] Open a magic link in incognito → can't see the bake list without `BAKER_TOKEN`
- [ ] Stripe Customer Portal link in members' subscription receipts works (Stripe dashboard → Settings → Customer Portal → make sure it's activated)
- [ ] Resend's monthly free-tier budget (~3k emails) won't be blown by your member count
- [ ] CFO permit number is filled in on the site (search `site.ts` for `PENDING`)
- [ ] Privacy policy + terms page exists (small; even a one-pager is fine for CFO)

---

## Common breakages and where to look

| Symptom | Most likely cause | Fix |
|---|---|---|
| Stripe checkout returns 503 | `STRIPE_SECRET_KEY` not set in Vercel | Add it, redeploy |
| Webhook events fire but inventory doesn't decrement | `STRIPE_WEBHOOK_SECRET` or `SANITY_API_WRITE_TOKEN` missing | Vercel → Logs filter on `/api/webhooks/stripe` to see the actual error |
| `/club/<id>` always shows "link didn't check out" | `CLUB_LINK_SECRET` differs between laptop and Vercel | Make sure both have the same value |
| `/admin/club` says "wrong token" | `BAKER_TOKEN` not set or doesn't match what you're typing | Re-paste from `.env.local` to Vercel; redeploy |
| Confirmation email doesn't arrive | Resend free-tier rule: recipient must match Resend account email until your domain is verified | Either test with your Resend signup email, or finish domain verification |
| Sanity returns CORS error in browser console | Production URL not on Sanity's CORS allow-list | Add the URL at `manage.sanity.io/project/.../api/cors` |
| Page is suddenly missing data after a Studio change | Next.js fetch cache (60s) | Wait 60s or redeploy. `/club` and `/admin/club` already use `{ fresh: true }`, but other pages don't |
