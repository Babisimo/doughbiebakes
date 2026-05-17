# How Sanity works (the Doughbie menu CMS)

This is your **content management system** — where you add/edit loaves, set up
weekly drops, and upload photos. You never touch code to change the menu.

- **Project:** "Doughbie" — id `91s54g5t`, dataset `production` (public-read).
- **Where you edit:** the **Studio**, baked into the site at **`/studio`**
  (e.g. `http://localhost:3000/studio` in dev, `https://yourdomain/studio` once
  deployed). Same login as your Sanity account. *(Prefer a standalone window?
  `npx sanity dev` runs the Studio on `http://localhost:3333`.)*
- **How the site reads it:** the storefront fetches **published** content from
  Sanity's CDN with **no token**, and **re-checks every ~60 seconds**. Drafts
  and unpublished docs are *never* visible on the public site.
- **No content yet?** The site falls back to the bundled demo menu
  (`src/lib/seed-products.ts`). The moment you publish real `product` docs, they
  take over. So an empty dataset is fine — nothing breaks.

> One-time setup before the Studio works: in
> [manage.sanity.io → project Doughbie → API → CORS origins](https://www.sanity.io/manage/project/91s54g5t/api),
> **Add origin** `http://localhost:3000` with **Allow credentials** checked (add
> your production domain later). Or from a terminal in this folder:
> `npx sanity login` then `npx sanity cors add http://localhost:3000 --credentials`.

---

## The three content types

| Type | What it is | Key fields |
|---|---|---|
| **Product** | A loaf, the starter, or merch — *anything you ever bake.* Lives on the **Menu** forever. | name, slug, price (**in cents** — `1200` = $12.00), photo, **ingredients**, **allergens**, category, **Available for ordering** (toggle) |
| **Drop** | A *scheduled, limited batch* — what's actually for sale this weekend. Shown on the home page. | title, **status** (Draft / Announced / Open / Sold out / Closed), order-open & order-close dates, pickup/ship date, note, **line items** = list of *(Product → quantity)* |
| **Category** | Groups products on the Menu page (e.g. "Signature Loaves", "Inclusions"). | title, slug, description |

See `ORDERS.md` for exactly how Menu vs. Drop behave for customers.

---

## Draft → Published → live: the lifecycle

Every document has at most two versions: a **draft** (your work-in-progress) and
the **published** version (what the public site shows).

### Creating something new
1. Studio → pick a type (e.g. **Product**) → **Create new**.
2. Fill in the fields. As you type, it's auto-saved as a **draft** — the public
   site can't see it yet.
3. Click **Publish** (bottom-right of the document). Now it's live; the site
   picks it up within ~60s (or immediately after the next deploy / cache
   revalidation).

### Editing something that's already published
1. Open the document and change a field. Sanity quietly makes a **new draft on
   top of** the published version. The site still shows the *old* published
   version until you publish again.
2. **Publish** to push your changes live — **or** click **"Discard changes"**
   (in the **⋯** menu, or the revert arrow) to throw away the draft and snap
   back to the published version.

So: *draft = "saved but not live", published = "live", and editing a live doc
parks your changes in a draft until you hit Publish.*

---

## Taking something down

You have three options, from gentlest to most permanent:

1. **Just make it unavailable (recommended for "temporarily out").**
   For a **Product**, turn the **"Available for ordering"** toggle **off** and
   Publish. The loaf still shows on the Menu (with its ingredients/allergens),
   but the "Add to order" button is disabled / shows "Sold out". For a **Drop**,
   set its **status** to `Sold out` or `Closed` — don't unpublish it.
2. **Unpublish (remove from the site, keep a copy).**
   Open the document → **⋯** menu → **Unpublish**. The published version is
   removed (so it vanishes from the site), but a draft is kept. To bring it back
   later, open it and **Publish** again. Good for seasonal items.
3. **Delete (gone for good).**
   Open the document → **⋯** menu → **Delete**. Removes both the draft and the
   published version permanently. Use Unpublish instead if there's any chance
   you'll want it back. ⚠️ Don't delete a Product that's referenced by a past
   Drop you still care about — unpublish it instead.

---

## Running a weekly Drop (step by step)

1. **Create a Drop**, status **`Draft`**. Give it a title ("Mother's Day Drop")
   and a slug.
2. Add **line items**: for each loaf you're baking, pick the **Product** and set
   the **quantity** (e.g. 4 Classic Country, 2 Cheddar & Jalapeño…).
3. Set **Orders open at**, **Orders close at**, and **Pickup / ship date**.
4. Add a **note to customers** if you want (pickup window, etc.).
5. **Publish.** While status is `Draft` the public site ignores it, so you can
   prep in peace.
6. When you're ready to tease it: change status to **`Announced`** → Publish.
   The home page shows it as "Dropping soon."
7. To open orders: change status to **`Open for orders`** → Publish. Now it's
   live and buyable. **Keep only one drop `Open` at a time** (the site picks the
   one whose pickup date is soonest).
8. As orders come in, quantities tick down **automatically** (the Stripe webhook
   decrements them — needs `SANITY_API_WRITE_TOKEN`). You can also edit
   quantities by hand any time. When everything's at 0 the drop flips itself to
   **`Sold out`** (or set it manually).
9. After you've baked and handed everything off, set status to **`Closed`** →
   Publish. The home page goes back to "no open drop" until the next one.

---

## Photos

Upload images right in the Studio on the Product's **Photo** field (drag & drop;
use the hotspot tool to pick the focal point). The storefront serves them from
`cdn.sanity.io`, which is already allow-listed in `next.config.ts`. Products
without a photo just show a tasteful gradient tile + 🍞 — so you can launch
before the photo shoot.

---

## Handy extras

- **Test queries:** Studio → **Vision** tab → run GROQ, e.g.
  `*[_type == "product"]{name, priceCents}` or `*[_type == "drop" && status == "open"][0]`.
- **The exact queries the site uses** live in `src/sanity/lib/queries.ts`.
- **Bulk-seed the starter menu:** `npm run seed:sanity` pushes the 5 demo loaves
  + a sample open drop. It needs an **Editor token** in
  `SANITY_API_WRITE_TOKEN` (see below). Safe to re-run — it won't overwrite docs
  you've edited.
- **Need a write token** (for the seed script *and* for the webhook to
  auto-decrement inventory): [manage.sanity.io → project Doughbie → API →
  Tokens → Add API token](https://www.sanity.io/manage/project/91s54g5t/api),
  role **Editor** → paste it into `SANITY_API_WRITE_TOKEN` in `.env.local`.
  Treat it like a password. The token in `sanity_token_api.txt` is **read-only**
  and won't work for writes.
- **Schemas** (what fields exist, validation, dropdown options) are defined in
  code in `src/sanity/schemaTypes/`. Change them there and the Studio updates.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Add a new loaf | Studio → Product → Create new → fill in → **Publish** |
| Fix a typo / change a price | Open the Product → edit → **Publish** (or **Discard changes** to revert) |
| Temporarily stop selling a loaf | Product → turn **"Available for ordering"** off → **Publish** |
| Permanently retire a loaf | Product → **⋯** → **Unpublish** (keeps a copy) — or **Delete** (gone) |
| Start this week's sale | Drop → status **Open for orders** → **Publish** (only one open at a time) |
| Mark a drop sold out / done | Drop → status **Sold out** or **Closed** → **Publish** |
| Bring a retired item back | Open it → **Publish** |
| Test what the API returns | Studio → **Vision** tab |
| Wipe & re-seed the demo menu | Delete the docs in the Studio, then `npm run seed:sanity` |
