# Handoff — pending work

Running list of known-but-deferred work. Each item: what, why it matters, where,
how to fix, and current status. Remove an item when it's done.

---

## 1. `order` reads use the tokenless client — will miss paid orders once live

**Status:** PENDING (deferred 2026-06-20 — safe to defer while prelaunch).

**What:** `getLiveOrdersForDrop` (and any other read of `order` docs) goes through
the public, tokenless Sanity client (`fetchSanity` in `src/lib/catalog.ts`). The
dataset restricts some sensitive types from unauthenticated reads. `dropFinancials`
was confirmed restricted; `order` is very likely restricted too (it was empty at
check time, so unconfirmed). Reservations are public, so the bake list currently
works off reservations.

**Why it matters:** The store is **prelaunch** with **0 Stripe orders**, so nothing
breaks today. Once you flip to `live` and take card payments, paid `order` docs
may be invisible to the bake list / "Actually collected" / financials — the same
class of bug that hid the dashboard.

**Where:** `src/lib/catalog.ts` → `getLiveOrdersForDrop` (uses `fetchSanity`).
Compare with the already-fixed `getAllDropFinancials` / `getDropFinancials`, which
use the server-only `authedClient` + `fetchAuthed()` in the same file.

**How to fix:** Route `getLiveOrdersForDrop` (and any other admin/server `order`
read) through `fetchAuthed()` instead of `fetchSanity`. First confirm the
restriction once an order exists: tokenless vs token `count(*[_type=="order"])`.

**Verify:** with a real (or seeded) live order, the bake list and the calculator's
"Actually collected" include it.

---

## 2. `reservation` docs are publicly readable — customer PII exposure

**Status:** PENDING (deferred 2026-06-20).

**What:** `reservation` documents are readable via the public/tokenless Sanity API
(confirmed: tokenless `count(*[_type=="reservation"])` returned all docs). Each
reservation holds `customerName`, `customerEmail`, `customerPhone`.

**Why it matters:** Anyone with the project id can read customer PII through the
public Content Lake API. The storefront genuinely needs *some* reservation read
for availability (pending reservations hold stock — see
`PENDING_RESERVATION_ITEMS_FOR_DROP_QUERY`), but it does NOT need to expose the
contact fields publicly.

**Where:** Sanity dataset read access (project `91s54g5t/production`) +
`src/sanity/lib/queries.ts` reservation queries. App read client has no token
(`src/sanity/client.ts`).

**How to fix (options):**
- Tighten the dataset so `reservation` requires a token, then move admin
  reservation reads to a token-bearing client (like the financials fix). Keep the
  public availability read limited to non-PII fields, or compute stock holds via a
  server route.
- Or restructure so the public availability check doesn't read reservation PII at
  all (e.g., a derived stock-hold field on the drop).

**Verify:** tokenless query for reservations returns no PII (or nothing);
admin reservation list still works; public availability/stock holds still correct.

---

See also project memory: `sanity-restricted-read-types`,
`known-issue-order-drop-attribution`.
