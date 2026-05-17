# Branded Email Restyle — Design

Date: 2026-05-17
Status: Approved (pending written-spec review)

## Problem

Transactional emails look unstyled. `reservation-email.ts` sends all four
templates as raw `<pre>` monospace text; `order-email.ts`'s baker alert is
raw `<pre>` and its customer email is a minimally-styled `<div>`. Only
`club-confirmation-email.ts` is properly branded — and it uses a slightly
different palette than the site. The owner wants a consistent, professional
look using the **site's brand colors**.

## Goal

All **7** transactional emails rebuilt on **one shared, branded HTML shell**
in the site palette:
1. Order confirmation (customer) — `order-email.ts`
2. New paid order (baker) — `order-email.ts`
3. Reservation request received (customer) — `reservation-email.ts`
4. New pickup reservation (baker, with Approve/Decline links) — `reservation-email.ts`
5. Reservation confirmed (customer) — `reservation-email.ts`
6. Reservation declined (customer) — `reservation-email.ts`
7. Bread Club loaf reserved (customer) — `club-confirmation-email.ts` (re-skin)

## Non-goals

- No change to *when*/*whether* emails send, recipients, subjects, or the
  signed Approve/Decline link logic.
- **Plaintext (`text`) bodies stay byte-for-byte unchanged** for every email
  (accessibility + deliverability).
- No email framework / new dependency (MJML, react-email). No build step.
- No VML "bulletproof" Outlook buttons (accepted minor: Outlook may square
  pill corners).
- No web fonts / external images / JS in emails.

## Architecture (Approach A: shared shell + helpers)

The header band is just the `🍞 {site.name}` wordmark (no secondary tagline
— the per-email eyebrow already provides context, and `site.tagline` is too
long for a header).

New pure module **`src/lib/email-layout.ts`** — no `import "server-only"` so
it is unit-testable by `node:test` (same rationale as `drop-status.ts`;
contains no secrets). The three composer modules build only their *content*
with shared helpers and wrap it with `renderEmail`; their `text` builders and
send/orchestration logic are untouched.

### Exports of `email-layout.ts`

- Brand color constants (from `globals.css @theme`):
  `INK="#283618"`, `INK_700="#36441f"`, `INK_500="#6c7150"`,
  `BONE="#fefae0"`, `PAPER="#fffdf2"`, `ACID="#a55d1f"`,
  `SAGE="#ccd5ae"`, `OCHRE="#dda15e"`, `FLAME="#606c38"`.
- `escapeHtml(s: string): string` — the single shared escaper (replaces the
  three duplicate local copies). Escapes `& < > " '`.
- `renderEmail(opts: { preheader: string; eyebrow: string; heading: string;
  bodyHtml: string; footerNote?: string }): string` — returns the full
  `<!doctype html>` document (see Shell structure).
- `emailButton(href: string, label: string, variant?: "primary" |
  "secondary"): string` — inline-styled padded-anchor pill. primary =
  terracotta fill / cream text / forest border; secondary = paper fill / ink
  text / forest border. `href` passed through `escapeHtml`.
- `lineItemsTable(rows: { label: string; amount: string }[], totalRow?:
  { label: string; amount: string }): string` — 100%-width table, label
  left / amount right, hairline row borders, bold total row. The helper
  **escapes `label` internally** (callers pass raw text like
  `` `${qty}× ${name}` ``); `amount` is a pre-formatted currency string
  (e.g. `formatPrice(...)`) and is emitted as-is (not escaped).
- `infoCard(innerHtml: string, tone?: "ochre" | "sage"): string` — callout
  box, tinted background + matching border, rounded. `tone` defaults to
  `"ochre"`. `innerHtml` is markup — callers escape any customer values.

### Shell structure (`renderEmail`)

```
<!doctype html><html lang="en">
<head><meta charset=utf-8><meta name=viewport content="width=device-width">
  <title>{site.name}</title></head>
<body style="margin:0;padding:0;background:#fefae0;
  -webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;
    mso-hide:all;">{escaped preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    border="0" style="background:#fefae0;padding:32px 16px;">
   <tr><td align="center">
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       border="0" style="max-width:560px;background:#fffdf2;
       border:2px solid #283618;border-radius:20px;
       box-shadow:8px 8px 0 0 rgba(40,54,24,0.18);overflow:hidden;">
       <!-- header band -->
       <tr><td style="padding:22px 28px;border-bottom:2px solid #283618;">
         <span style="font-family:'Cooper Black',Georgia,'Times New Roman',
           serif;font-size:24px;color:#283618;">🍞 {site.name}</span>
       </td></tr>
       <!-- eyebrow + heading -->
       <tr><td style="padding:26px 28px 4px;">
         <p style="margin:0;font-size:12px;letter-spacing:0.16em;
           text-transform:uppercase;color:#6c7150;">{escaped eyebrow}</p>
         <h1 style="margin:6px 0 0;font-family:'Cooper Black',Georgia,serif;
           font-size:26px;line-height:1.2;color:#283618;">
           {escaped heading}</h1>
       </td></tr>
       <!-- body slot -->
       <tr><td style="padding:10px 28px 24px;font-family:-apple-system,
         BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
         font-size:15px;line-height:1.55;color:#36441f;">{bodyHtml}</td></tr>
       <!-- footer -->
       <tr><td style="padding:16px 28px 26px;
         border-top:1px solid rgba(40,54,24,0.15);font-size:12px;
         color:#6c7150;font-family:-apple-system,...sans-serif;">
         {footerNote ? escaped footerNote + "<br/>" : ""}
         {site.name} · {site.city} · {site.cottageFood.madeIn}.
         {site.cottageFood.permitNumber}.<br/>
         Questions? Just reply to this email.
       </td></tr>
     </table>
     <p style="margin:16px 0 0;font-size:11px;color:#6c7150;
       font-family:...sans-serif;">© {year} {site.name} · {site.city}</p>
   </td></tr>
  </table>
</body></html>
```

`bodyHtml` is composed by callers from the helpers and is **not** escaped by
`renderEmail` (it is markup). `preheader`, `eyebrow`, `heading`,
`footerNote` are plain strings and ARE escaped by `renderEmail`. Callers are
responsible for escaping any customer-controlled values they interpolate
into `bodyHtml` (using the shared `escapeHtml`) — same discipline as today.

## Per-email content

Each composer keeps its input types, `subject`, `text` builder, and
send/orchestration logic. Only the `html` is rebuilt as
`renderEmail({ preheader, eyebrow, heading, bodyHtml, footerNote })` where
`bodyHtml` uses the helpers:

1. **Order — customer**: eyebrow `ORDER CONFIRMED`; heading
   `Thanks{, name} — you're all set 🍞`; body = `lineItemsTable` (each line
   `{quantity}× {name}` → amount; then Subtotal, Shipping (or "Free
   (pickup)"), bold **Total**) + `infoCard(fulfillmentText, "ochre")`.
   footerNote: "Everything is baked to order."
2. **Order — baker**: eyebrow `NEW PAID ORDER`; heading
   `{orderRef} · {formatPrice(total)}`; body = a small details block
   (`Customer: name <email>`, fulfillment/state) + `lineItemsTable`
   (items + total). No CTA. Sent to `site.email`.
3. **Reservation — received (customer)**: eyebrow `RESERVATION REQUESTED`;
   heading `Thanks {name} — request received`; body =
   `infoCard("Not confirmed yet — we'll email you once it's approved.",
   "ochre")` + `lineItemsTable` (items + **Total due at pickup**) + a pickup
   line (`Pickup in {city} on {when}.`).
4. **Reservation — baker alert**: eyebrow `NEW PICKUP RESERVATION`; heading
   `{name} · {formatPrice(total)} due at pickup`; body = contact line
   (`{name} <{email}> · {phone}`) + `lineItemsTable` +
   `emailButton(approveUrl,"✅ Approve & hold stock","primary")` +
   `emailButton(declineUrl,"Decline","secondary")`. Sent to `site.email`.
   Signed-link construction (`signReservationToken`) is unchanged.
5. **Reservation — confirmed (customer)**: eyebrow `RESERVATION CONFIRMED`;
   heading `You're confirmed, {name}! 🍞`; body =
   `infoCard("Pay {formatPrice(total)} at pickup (cash or card) · pickup
   {when} in {city}", "sage")` + `lineItemsTable`.
6. **Reservation — declined (customer)**: eyebrow `RESERVATION UPDATE`;
   heading `Sorry — {why}`; body = soft copy ("No charge was made. Catch the
   next {site.name} drop!"). (No items table needed.)
7. **Bread Club (customer)**: eyebrow `BREAD CLUB`; heading
   `Your loaf is reserved 🍞`; body = intro line +
   `infoCard` (Flavor / Fulfillment / Drop date) + fulfillment note
   (+ optional shipping line) + `emailButton(selfServeUrl,"Change my pick",
   "primary")` + the "open any time before the drop opens" note.

Customer-controlled values (`customerName`, product names, flavor, drop
title, etc.) are escaped via the shared `escapeHtml` exactly where they are
today.

## Email-client constraints (accepted)

- Inline CSS only; `role="presentation"` tables; single column;
  `max-width:560px`.
- Explicit background + text colors on body and every cell (best-effort
  dark-mode resilience; some clients still recolor — accepted).
- No external fonts/images/JS; 🍞 emoji is the only "logo".
- `box-shadow` is progressive enhancement; the 2px forest border carries the
  card where shadow is stripped (Gmail).
- Buttons are padded `<a>` pills; Outlook may not round corners — accepted.
- Hidden preheader span per email for a clean inbox preview.
- Plaintext `text` body unchanged for every email.

## Files

- **New** `src/lib/email-layout.ts` (pure; brand consts + `escapeHtml` +
  `renderEmail` + `emailButton` + `lineItemsTable` + `infoCard`).
- **New** `src/lib/__tests__/email-layout.test.ts` (`node:test`, imports
  `../email-layout.ts`).
- **Changed** `src/lib/order-email.ts` — `customerHtml` and the baker `<pre>`
  rebuilt via helpers + `renderEmail`; remove its local `escapeHtml` (import
  the shared one); keep `OrderEmailInput`/`OrderEmailLine`,
  `fulfillmentText`, `customerText`, `bakerText`, `sendOrderEmails`,
  `import "server-only"`.
- **Changed** `src/lib/reservation-email.ts` — the four `<pre>` html bodies
  rebuilt via helpers + `renderEmail`; remove its local `esc`; keep types,
  `lines`/`when` helpers, all four exported `send*` functions, the
  signed-link construction, `import "server-only"`.
- **Changed** `src/lib/club-confirmation-email.ts` — `html` rebuilt via
  helpers + `renderEmail` (re-skinned to site palette); remove local
  `escapeHtml`/`escapeAttr`; keep `buildClubConfirmation` signature,
  `subject`, `text`, and its module's current (no-`server-only`) status.

## Testing

- `node:test` (`email-layout.test.ts`, pattern of `drop-status.test.ts`):
  `escapeHtml` escapes the five chars; `renderEmail` output contains the
  preheader, the escaped heading/eyebrow, the body markup verbatim, the
  footer Cottage-Food line, and a single `<!doctype html>`; `emailButton`
  emits an `<a href>` with the expected inline styles per variant and an
  escaped href; `lineItemsTable` emits one row per item plus the total row
  and escapes a `<`-containing label; `infoCard` emits the tone background.
  Pure → deterministic.
- `npm run typecheck`, `npm run lint`, `npm run build` green.
- **Manual (stated, not claimed):** trigger/send each of the 7 emails and
  eyeball rendering in Gmail + Apple Mail (and ideally Outlook). No headless
  browser here, so visual rendering is NOT verified by this work — it must
  be checked manually after merge.

## Acceptance criteria

- All 7 emails render the shared branded shell in the site palette (cream
  page, paper card, forest border, terracotta primary button, sage/ochre
  accents) — no raw `<pre>` remains in any composer.
- Every email's `subject`, recipients, send conditions, signed links, and
  plaintext `text` body are byte-for-byte unchanged.
- `escapeHtml` exists once (in `email-layout.ts`); the three local copies are
  gone; all customer-controlled interpolations remain escaped.
- `email-layout.ts` is pure, unit-tested, and importable by the three
  (server-only-where-they-were) composers without breaking the build.
- typecheck / lint / `node:test` / `next build` all pass.

## Risks / tradeoffs (accepted)

- Outlook may square button corners and ignore `box-shadow`; the bordered
  card + padded buttons still read as professional. No VML (over-engineering
  at Cottage-Food scale).
- Dark-mode clients may recolor backgrounds despite explicit colors —
  unavoidable in email; the existing club email already lives with this.
- Visual fidelity is verified manually post-merge, not by automated tests.
