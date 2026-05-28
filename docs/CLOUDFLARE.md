# Hosting Doughbie on Cloudflare (free) + Stripe go-live

Runbook for moving the storefront off Vercel onto Cloudflare's free tier and
flipping Stripe from test mode to live. Drafted with Gemini, then corrected
against the actual code in this repo — see **"Corrections to the Gemini draft"**
at the bottom for what changed and why.

> **Read this first — the #1 risk.** This project runs a modified, bleeding-edge
> **Next.js 16.2.6** (see `AGENTS.md`). The Cloudflare adapter (`@opennextjs/cloudflare`)
> tracks Next.js closely but Next 16 support may lag or break. **Before you commit
> to Cloudflare, do step 1 and get a local `opennextjs-cloudflare build` to pass.**
> If it doesn't, the fallback is Vercel Pro ($20/mo) — see step 9. Don't change
> DNS or Stripe until the build is green.

---

## 0. Architecture decision

- **Host:** Cloudflare **Workers** (not Pages) via the **`@opennextjs/cloudflare`**
  (OpenNext) adapter. OpenNext is the maintained path; the older
  `@cloudflare/next-on-pages` is legacy and **edge-runtime only** — it cannot run
  this app.
- **Keep `export const runtime = "nodejs"` on all 16 API routes.** OpenNext on
  Cloudflare runs your code in a Worker with the `nodejs_compat` flag, which
  provides `node:crypto`, `Buffer`, etc. **Do not switch routes to `"edge"`** —
  that would break `timingSafeEqual`, `randomBytes`, and the Stripe SDK.
- **Free tier reality:** Workers free = 100k requests/day, generous-but-finite
  CPU per request. Fine for a bakery storefront; see step 7 for the caveats.

OpenNext moves fast — treat the exact commands below as a starting point and
cross-check <https://opennext.js.org/cloudflare> for the current version.

---

## 1. Prove the build works locally (do this before anything else)

```powershell
npm install @opennextjs/cloudflare@latest
npm install -D wrangler@latest
```

Create `open-next.config.ts` in the project root:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
```

Create `wrangler.jsonc` in the project root:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "doughbie-app",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-03-25",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  }
}
```

Add to `package.json` scripts:

```json
"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
"deploy:cf": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
```

Then build and preview locally:

```powershell
npx opennextjs-cloudflare build
npx opennextjs-cloudflare preview
```

**If the build fails**, that is the Next 16 compatibility risk biting. Stop here,
note the error, and consider the Vercel Pro fallback (step 9). Do not proceed.

---

## 2. Apply the required Stripe webhook code change

The webhook (`src/app/api/webhooks/stripe/route.ts`) currently uses the
**synchronous** `stripe.webhooks.constructEvent(...)`. That relies on Node's
native crypto and **fails on the Cloudflare runtime**. It must become the
async, Web Crypto variant:

```diff
-    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
+    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
```

Also harden the Stripe client in `src/lib/stripe.ts` so it uses a fetch-based
HTTP client (safe on every runtime, required on Workers):

```diff
   cached = key
     ? new Stripe(key, {
         apiVersion: "2026-04-22.dahlia",
         appInfo: { name: "doughbie" },
+        httpClient: Stripe.createFetchHttpClient(),
       })
     : null;
```

Keep `apiVersion` exactly as it is in the repo (`2026-04-22.dahlia`) — do not
downgrade it. Re-run `npx opennextjs-cloudflare build` after the edits.

---

## 3. Create the Cloudflare project + connect GitHub

1. Push the branch to GitHub if it isn't already.
2. Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to Git**
   (this is "Workers Builds" — git auto-deploy for Workers).
3. Pick the repo. Build settings:
   - **Build command:** `npx opennextjs-cloudflare build`
   - **Deploy command:** `npx opennextjs-cloudflare deploy`
   - **Node version:** 20+ (set via a `.nvmrc` or the dashboard).
4. Every push to `main` now deploys automatically.

---

## 4. Environment variables & secrets on Cloudflare

Two classes of variable:

| Class | Which vars | Where they go |
|---|---|---|
| **Public, build-time** (`NEXT_PUBLIC_*`) | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`, `NEXT_PUBLIC_SANITY_API_VERSION` | Dashboard → your Worker → **Settings → Variables & Secrets**. Must exist at **build** time (they get inlined into the client bundle). |
| **Server secrets** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BREAD_CLUB_PRICE_ID`, `SANITY_API_WRITE_TOKEN`, `CLUB_LINK_SECRET`, `BAKER_TOKEN`, `RESEND_API_KEY`, `FROM_EMAIL` | Add as **Secrets** (encrypted). Either the dashboard, or CLI: |

```powershell
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put SANITY_API_WRITE_TOKEN
wrangler secret put CLUB_LINK_SECRET
wrangler secret put BAKER_TOKEN
wrangler secret put RESEND_API_KEY
```

Never put secrets in `wrangler.jsonc` `vars` — that file is committed to git.

---

## 5. Custom domain + DNS

1. Worker → **Settings → Domains & Routes → Add → Custom Domain** → enter your
   domain. Cloudflare provisions the TLS cert automatically.
2. If the domain is registered at Cloudflare, DNS is automatic. If elsewhere,
   move the nameservers to Cloudflare (or add the records Cloudflare shows).
3. Set `NEXT_PUBLIC_SITE_URL` to the final `https://` domain and redeploy — this
   value builds the Stripe redirect URLs and the Bread Club magic links.

---

## 6. Wire up Stripe + Sanity for the live host

- **Stripe webhook:** dashboard → Developers → Webhooks → Add endpoint →
  `https://<your-domain>/api/webhooks/stripe`. **Event to subscribe to:**
  `checkout.session.completed` — **that is the only event this app handles**
  (both one-time orders and Bread Club card-saves run through it). Copy the
  signing secret into the `STRIPE_WEBHOOK_SECRET` secret.
- **Sanity CORS:** <https://manage.sanity.io> → project `91s54g5t` → API → CORS
  origins → add `https://<your-domain>` (credentials unchecked).
- **Resend:** verify your sending domain so emails reach real customers, then
  update `FROM_EMAIL`. Until verified, Resend only delivers to your own address.

---

## 7. Known gotchas on the free tier

- **Rate limiter** (`src/lib/rate-limit.ts`) is an in-process `Map`. On Workers
  it resets constantly and is per-isolate — effectively decorative. It's already
  documented as best-effort, so this is acceptable for launch, but if abuse
  becomes real, move to **Cloudflare WAF Rate Limiting** or a **KV**-backed
  counter. Not a launch blocker.
- **Image optimization:** `next/image` is used only for `cdn.sanity.io` photos.
  OpenNext shims the optimizer; if images are slow, use Sanity's own image CDN
  params (`?w=…&q=…`) via the existing image URL builder instead.
- **Fetch caching:** pages cache Sanity fetches ~60s; `/club` and `/admin/club`
  already opt out with `{ fresh: true }`. A Studio edit can take up to a minute
  to surface elsewhere — expected, not a bug.
- **Embedded Studio** at `/studio` is client-only and should just work; verify
  it loads after deploy.
- **CPU limits:** the webhook makes several sequential Stripe API calls
  (`listLineItems`, etc.). Normal, but watch the Worker logs for CPU-limit errors
  under load.

---

## 8. Stripe production-readiness (test mode → live mode)

Test mode and live mode are separate universes — live keys start you with an
empty Stripe slate.

1. **Activate the account:** Stripe dashboard → complete the business profile
   and bank account. Required before you can take real money. Cottage Food fits
   "specialty food store."
2. **Live API keys:** swap `STRIPE_SECRET_KEY` → `sk_live_…` and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `pk_live_…` in Cloudflare.
3. **Recreate the Bread Club price in live mode:** test prices don't carry over.
   Make the recurring/price object again, put its new `price_…` in
   `STRIPE_BREAD_CLUB_PRICE_ID`. Keep `site.breadClub` copy in sync.
4. **Live webhook endpoint:** create it against the production URL, subscribe to
   `checkout.session.completed` only, copy the **new** `whsec_…` into
   `STRIPE_WEBHOOK_SECRET` (the live secret differs from the test one).
5. **Customer Portal:** Stripe → Settings → Billing → Customer Portal → activate
   it (members' card-management links break if it's off).
6. **Statement descriptor:** set it to something recognizable, e.g.
   `DOUGHBIE BAKERY`, so customers don't dispute the charge.
7. **Cottage Food compliance:** Stripe Checkout cannot hard-restrict shipping to
   California. The webhook already logs a ⚠️ for non-CA addresses — you must
   review every shipped order before fulfilling and refund any out-of-state one.
8. **Rotate secrets for production:** generate fresh `CLUB_LINK_SECRET`,
   `BAKER_TOKEN`, a new Sanity write token, and a new Resend key — set them only
   in Cloudflare, never in the repo.
9. **One real low-value live order**, confirm the webhook fires and the order
   records in Sanity, then refund yourself.

---

## 9. Fallback if OpenNext can't build Next 16

If step 1 won't build, you have two clean options:

- **Vercel Pro ($20/mo):** zero code changes — the app already deploys to Vercel.
  You can still use Cloudflare for DNS only (DNS-only / grey cloud).
- **Wait / pin:** check the OpenNext changelog for Next 16 support and retry; in
  the meantime stay on the Vercel deployment described in `docs/DEPLOY.md`.

---

## Corrections to the Gemini draft

The first-pass plan from `gemini` contained four errors, corrected above:

1. **"Change `runtime = "nodejs"` to `"edge"`."** Wrong and self-contradictory.
   OpenNext on Cloudflare runs the **Node.js** runtime via `nodejs_compat`;
   switching to edge would break `node:crypto` (used by admin auth and tokens).
   Routes stay `"nodejs"`.
2. **"Deploy to Cloudflare Pages with `wrangler pages deploy`."** Outdated. The
   current `@opennextjs/cloudflare` targets Cloudflare **Workers**
   (`opennextjs-cloudflare deploy`, `wrangler.jsonc` with `main`/`assets`).
3. **Webhook events `customer.subscription.deleted` / `invoice.payment_succeeded`.**
   Wrong for this app. The Bread Club is **not** a Stripe subscription — joining
   is a `setup`-mode Checkout that saves a card, and members are billed by
   manual `off_session` PaymentIntents from `/api/admin/club/charge`. The webhook
   only handles `checkout.session.completed`; that is the only event to subscribe.
4. **"50ms CPU limit."** Imprecise; Workers free CPU limits are higher than that
   and not worth quoting exactly — the real watch-item is the multi-call webhook.

The `constructEventAsync` fix (step 2) is the one thing Gemini got exactly right
and it is **mandatory**.
