# Branded Email Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all 7 transactional emails on one shared, brand-styled HTML shell in the site palette, leaving every subject/recipient/plaintext/logic byte-for-byte unchanged.

**Architecture:** A new pure `src/lib/email-layout.ts` exports `renderEmail` + inline-styled helpers (`emailButton`, `lineItemsTable`, `infoCard`, `escapeHtml`, brand color consts). The 3 composer modules build only their content with these helpers and wrap with `renderEmail`; their `text` builders and send logic are untouched.

**Tech Stack:** TypeScript, Resend (existing `sendEmail`), `node:test` (Node ≥22.6, `--experimental-strip-types`; tsconfig has `allowImportingTsExtensions`). Email = inline CSS + `role="presentation"` tables, no deps.

**Spec:** `docs/superpowers/specs/2026-05-17-email-styling-design.md`

> **node:test import rule (established this codebase):** a module loaded by a `*.test.ts` resolves its relative *value* imports at runtime, so it needs `.ts` specifiers through that chain (build-verified safe with Next 16 + `allowImportingTsExtensions`). `email-layout.ts` value-imports `./site`, so it MUST use `import { site } from "./site.ts";`, and the test imports `../email-layout.ts`. `site.ts` has no relative imports so it needs no change. The three server-only composer modules are NOT node-tested → they keep EXTENSIONLESS imports (`./email-layout`).

---

### Task 1: `email-layout.ts` shell + helpers (TDD)

**Files:**
- Create: `src/lib/__tests__/email-layout.test.ts`
- Create: `src/lib/email-layout.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/email-layout.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emailButton,
  escapeHtml,
  infoCard,
  lineItemsTable,
  renderEmail,
} from "../email-layout.ts";

test("escapeHtml escapes the five chars", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("renderEmail wraps content with shell + escapes string fields", () => {
  const html = renderEmail({
    preheader: "pre <x>",
    eyebrow: "ORDER",
    heading: "Hi <Bob>",
    bodyHtml: "<p data-test='x'>BODYMARKER</p>",
    footerNote: "note",
  });
  assert.equal(html.match(/<!doctype html>/gi)?.length, 1);
  assert.ok(html.includes("pre &lt;x&gt;")); // preheader escaped
  assert.ok(html.includes("Hi &lt;Bob&gt;")); // heading escaped
  assert.ok(html.includes("ORDER"));
  assert.ok(html.includes("<p data-test='x'>BODYMARKER</p>")); // body NOT escaped
  assert.ok(html.includes("Made in a Home Kitchen")); // cottage-food footer line
  assert.ok(html.includes("note"));
});

test("emailButton: variant styling + escaped href", () => {
  const p = emailButton("https://x.test/a?b=1&c=2", "Go");
  assert.ok(p.includes('href="https://x.test/a?b=1&amp;c=2"'));
  assert.ok(p.includes("#a55d1f")); // primary terracotta fill
  const s = emailButton("https://x.test", "No", "secondary");
  assert.ok(s.includes("#fffdf2")); // secondary paper fill
});

test("lineItemsTable: row per item + total, escapes label and amount", () => {
  const t = lineItemsTable(
    [
      { label: "2× A<b>", amount: "$2.00" },
      { label: "1× B", amount: "10 & 20" },
    ],
    { label: "Total", amount: "$3.00" },
  );
  assert.equal((t.match(/<tr>/g) ?? []).length, 3);
  assert.ok(t.includes("2× A&lt;b&gt;")); // label escaped
  assert.ok(t.includes("10 &amp; 20")); // amount escaped too
  assert.ok(t.includes("$3.00"));
});

test("infoCard: tone backgrounds + injects markup", () => {
  assert.ok(infoCard("<b>hi</b>").includes("<b>hi</b>")); // innerHtml is markup
  assert.ok(infoCard("hi").includes("#fbedd6")); // default ochre tint
  assert.ok(infoCard("hi", "sage").includes("#eef3df")); // sage tint
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test`
Expected: FAIL — `Cannot find module '../email-layout.ts'`.

- [ ] **Step 3: Implement `src/lib/email-layout.ts`**

```ts
import { site } from "./site.ts";

export const INK = "#283618";
export const INK_700 = "#36441f";
export const INK_500 = "#6c7150";
export const BONE = "#fefae0";
export const PAPER = "#fffdf2";
export const ACID = "#a55d1f";
export const SAGE = "#ccd5ae";
export const OCHRE = "#dda15e";
export const FLAME = "#606c38";

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Cooper Black',Georgia,'Times New Roman',serif";

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

export function emailButton(
  href: string,
  label: string,
  variant: "primary" | "secondary" = "primary",
): string {
  const bg = variant === "primary" ? ACID : PAPER;
  const fg = variant === "primary" ? PAPER : INK;
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;` +
    `padding:12px 22px;margin:8px 8px 0 0;background:${bg};color:${fg};` +
    `border:2px solid ${INK};border-radius:9999px;font-family:${SANS};` +
    `font-size:14px;font-weight:700;text-decoration:none;">` +
    `${escapeHtml(label)}</a>`
  );
}

export function lineItemsTable(
  rows: { label: string; amount: string }[],
  totalRow?: { label: string; amount: string },
): string {
  const cell = `padding:7px 0;border-bottom:1px solid rgba(40,54,24,0.12);font-size:15px;color:${INK_700};`;
  const body = rows
    .map(
      (r) =>
        `<tr><td style="${cell}">${escapeHtml(r.label)}</td>` +
        `<td style="${cell}text-align:right;white-space:nowrap;">${escapeHtml(r.amount)}</td></tr>`,
    )
    .join("");
  const tcell = `padding:12px 0 0;font-size:16px;font-weight:700;color:${INK};`;
  const total = totalRow
    ? `<tr><td style="${tcell}">${escapeHtml(totalRow.label)}</td>` +
      `<td style="${tcell}text-align:right;">${escapeHtml(totalRow.amount)}</td></tr>`
    : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `border="0" style="width:100%;border-collapse:collapse;margin:6px 0;">` +
    `${body}${total}</table>`
  );
}

export function infoCard(
  innerHtml: string,
  tone: "ochre" | "sage" = "ochre",
): string {
  const bg = tone === "sage" ? "#eef3df" : "#fbedd6";
  const border = tone === "sage" ? SAGE : OCHRE;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `border="0" style="width:100%;border-collapse:separate;margin:14px 0;">` +
    `<tr><td style="padding:14px 18px;background:${bg};border:1px solid ${border};` +
    `border-radius:12px;font-family:${SANS};font-size:14px;line-height:1.5;` +
    `color:${INK_700};">${innerHtml}</td></tr></table>`
  );
}

export function renderEmail(opts: {
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  const year = new Date().getFullYear();
  return (
    `<!doctype html><html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(site.name)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BONE};-webkit-text-size-adjust:100%;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">` +
    `${escapeHtml(opts.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${BONE};padding:32px 16px;"><tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="max-width:560px;background:${PAPER};border:2px solid ${INK};` +
    `border-radius:20px;box-shadow:8px 8px 0 0 rgba(40,54,24,0.18);overflow:hidden;">` +
    `<tr><td style="padding:22px 28px;border-bottom:2px solid ${INK};` +
    `font-family:${SERIF};font-size:24px;color:${INK};">🍞 ${escapeHtml(site.name)}</td></tr>` +
    `<tr><td style="padding:26px 28px 4px;font-family:${SANS};">` +
    `<p style="margin:0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;` +
    `color:${INK_500};">${escapeHtml(opts.eyebrow)}</p>` +
    `<h1 style="margin:6px 0 0;font-family:${SERIF};font-size:26px;line-height:1.2;` +
    `color:${INK};">${escapeHtml(opts.heading)}</h1></td></tr>` +
    `<tr><td style="padding:10px 28px 24px;font-family:${SANS};font-size:15px;` +
    `line-height:1.55;color:${INK_700};">${opts.bodyHtml}</td></tr>` +
    `<tr><td style="padding:16px 28px 26px;border-top:1px solid rgba(40,54,24,0.15);` +
    `font-family:${SANS};font-size:12px;color:${INK_500};">` +
    `${opts.footerNote ? escapeHtml(opts.footerNote) + "<br/>" : ""}` +
    `${escapeHtml(site.name)} · ${escapeHtml(site.city)} · ` +
    `${escapeHtml(site.cottageFood.madeIn)}. ${escapeHtml(site.cottageFood.permitNumber)}.` +
    `<br/>Questions? Just reply to this email.</td></tr></table>` +
    `<p style="margin:16px 0 0;font-family:${SANS};font-size:11px;color:${INK_500};">` +
    `© ${year} ${escapeHtml(site.name)} · ${escapeHtml(site.city)}</p>` +
    `</td></tr></table></body></html>`
  );
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test`
Expected: ALL pass (`# fail 0`; previously 23 → now 28: +5 email-layout tests).

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm run build` (succeeds — proves the `./site.ts` specifier is safe in the Next graph).

```bash
git add src/lib/email-layout.ts src/lib/__tests__/email-layout.test.ts
git commit -m "feat: add shared branded email-layout shell (tested)"
```

---

### Task 2: Restyle `order-email.ts`

**Files:**
- Modify: `src/lib/order-email.ts`

- [ ] **Step 1: Swap imports + remove the local escaper**

Current top of `src/lib/order-email.ts`:

```ts
import "server-only";

import { sendEmail } from "./email";
import { formatPrice } from "./money";
import { site } from "./site";
```

Replace with (add the shell import; the shared `escapeHtml` replaces the local one):

```ts
import "server-only";

import { sendEmail } from "./email";
import { escapeHtml, infoCard, lineItemsTable, renderEmail } from "./email-layout";
import { formatPrice } from "./money";
import { site } from "./site";
```

Then DELETE the entire local `escapeHtml` function (the `function escapeHtml(s: string): string { ... }` block) — the import now provides it.

- [ ] **Step 2: Replace `customerHtml` and add `bakerHtml`**

Replace the entire existing `customerHtml` function with these two functions (keep `fulfillmentText`, `OrderEmailInput`, `OrderEmailLine`, `customerText`, `bakerText` exactly as they are):

```ts
function customerHtml(input: OrderEmailInput): string {
  const items = input.lines.map((l) => ({
    label: `${l.quantity}× ${l.name}`,
    amount: formatPrice(l.amountCents),
  }));
  const rows = [
    ...items,
    { label: "Subtotal", amount: formatPrice(input.subtotalCents) },
    {
      label: "Shipping",
      amount:
        input.shippingCents > 0 ? formatPrice(input.shippingCents) : "Free (pickup)",
    },
  ];
  const body =
    lineItemsTable(rows, { label: "Total", amount: formatPrice(input.totalCents) }) +
    infoCard(escapeHtml(fulfillmentText(input)));
  return renderEmail({
    preheader: `Your ${site.name} order ${input.orderRef} is confirmed`,
    eyebrow: "Order confirmed",
    heading: `Thanks${input.customerName ? `, ${input.customerName}` : ""} — you're all set 🍞`,
    bodyHtml: body,
    footerNote: "Everything is baked to order.",
  });
}

function bakerHtml(input: OrderEmailInput): string {
  const items = input.lines.map((l) => ({
    label: `${l.quantity}× ${l.name}`,
    amount: formatPrice(l.amountCents),
  }));
  const fulfill = input.isPickup
    ? "LOCAL PICKUP"
    : `SHIP to ${input.shipState ?? "?"}`;
  const body =
    `<p style="margin:0 0 6px;">Customer: <strong>${escapeHtml(
      input.customerName ?? "(no name)",
    )}</strong> &lt;${escapeHtml(input.to)}&gt;</p>` +
    `<p style="margin:0 0 12px;">Fulfillment: <strong>${escapeHtml(fulfill)}</strong></p>` +
    lineItemsTable(items, { label: "Total", amount: formatPrice(input.totalCents) });
  return renderEmail({
    preheader: `New paid order ${input.orderRef} — ${formatPrice(input.totalCents)}`,
    eyebrow: "New paid order",
    heading: `${input.orderRef} · ${formatPrice(input.totalCents)}`,
    bodyHtml: body,
  });
}
```

- [ ] **Step 3: Use the new builders in `sendOrderEmails`**

In `sendOrderEmails`, the baker `sendEmail` call currently uses an inline `<pre>` for `html`. Change both `html` fields so the function body's two `sendEmail` calls are:

```ts
  try {
    await sendEmail({
      to: input.to,
      subject: `Your ${site.name} order is confirmed (${input.orderRef})`,
      html: customerHtml(input),
      text: customerText(input),
    });
  } catch (err) {
    console.error("[order-email] customer send failed", err);
  }

  try {
    await sendEmail({
      to: site.email,
      subject: `🍞 New order ${input.orderRef} — ${formatPrice(input.totalCents)}`,
      html: bakerHtml(input),
      text: bakerText(input),
    });
  } catch (err) {
    console.error("[order-email] baker send failed", err);
  }
```

(Only the two `html:` values change — `to`/`subject`/`text`/the try/catch are identical to before.)

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`, 28 pass), `npm run build` (succeeds).

```bash
git add src/lib/order-email.ts
git commit -m "feat: restyle order emails on shared shell"
```

---

### Task 3: Restyle `reservation-email.ts`

**Files:**
- Modify: `src/lib/reservation-email.ts`

The four `send*` functions currently build a `body` text string then send `html: \`<pre …>${esc(body)}</pre>\``, `text: body`. Keep the `text:` bodies and all logic EXACTLY; only replace each `html:` value with a `renderEmail(...)` built from helpers, and replace the local `esc` with the shared `escapeHtml`.

- [ ] **Step 1: Swap imports + drop local `esc`**

Current top of `src/lib/reservation-email.ts`:

```ts
import "server-only";

import { sendEmail } from "./email";
import { formatPrice } from "./money";
import { signReservationToken } from "./reservation-token";
import { site } from "./site";
import { siteUrl } from "./url";
```

Replace with:

```ts
import "server-only";

import { sendEmail } from "./email";
import {
  emailButton,
  escapeHtml,
  infoCard,
  lineItemsTable,
  renderEmail,
} from "./email-layout";
import { formatPrice } from "./money";
import { signReservationToken } from "./reservation-token";
import { site } from "./site";
import { siteUrl } from "./url";
```

Then DELETE the local `function esc(s: string): string { ... }` block. Keep the `lines(...)` and `when(...)` helpers, the types, and all four `send*` exports' signatures.

- [ ] **Step 2: `sendReservationReceived` — replace its `html:`**

Inside `sendReservationReceived`, keep the existing `const body = [...]` (used by `text`). Replace ONLY the `sendEmail({...})` call's `html` value. The full call becomes:

```ts
  const itemRows = input.lines.map((l) => ({
    label: `${l.quantity}× ${l.productName}`,
    amount: formatPrice(l.priceCents * l.quantity),
  }));
  const html = renderEmail({
    preheader: `We received your ${site.name} pickup reservation request`,
    eyebrow: "Reservation requested",
    heading: `Thanks ${input.customerName} — request received`,
    bodyHtml:
      infoCard(
        "It's not confirmed yet — we'll email you once it's approved.",
      ) +
      lineItemsTable(itemRows, {
        label: "Total due at pickup",
        amount: formatPrice(input.totalCents),
      }) +
      `<p style="margin:14px 0 0;">Pickup in ${escapeHtml(site.city)} on ${escapeHtml(
        when(input),
      )}. ${escapeHtml(site.cottageFood.madeIn)}.</p>`,
  });
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — reservation request received`,
      html,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] received send failed", err);
  }
```

- [ ] **Step 3: `sendReservationBakerAlert` — replace its `html:`**

Keep the existing `const base = siteUrl();`, the `link(action)` closure, and `const body = [...]`. Replace the `html` construction + `sendEmail` call with:

```ts
  const itemRows = input.lines.map((l) => ({
    label: `${l.quantity}× ${l.productName}`,
    amount: formatPrice(l.priceCents * l.quantity),
  }));
  const html = renderEmail({
    preheader: `New pickup reservation — ${formatPrice(input.totalCents)}`,
    eyebrow: "New pickup reservation",
    heading: `${input.customerName} · ${formatPrice(input.totalCents)}`,
    bodyHtml:
      `<p style="margin:0 0 6px;">${escapeHtml(input.customerName)} &lt;${escapeHtml(
        input.customerEmail,
      )}&gt;</p>` +
      `<p style="margin:0 0 12px;">${escapeHtml(input.customerPhone)}</p>` +
      lineItemsTable(itemRows, {
        label: "Total at pickup",
        amount: formatPrice(input.totalCents),
      }) +
      `<p style="margin:18px 0 0;">` +
      emailButton(link("approve"), "✅ Approve & hold stock", "primary") +
      emailButton(link("decline"), "Decline", "secondary") +
      `</p>`,
  });
  try {
    await sendEmail({
      to: site.email,
      subject: `🍞 New pickup reservation — ${formatPrice(input.totalCents)}`,
      html,
      text: `${body}\n\nApprove: ${link("approve")}\nDecline: ${link("decline")}`,
    });
  } catch (err) {
    console.error("[reservation-email] baker alert send failed", err);
  }
```

(The `text` value is exactly the existing one — `\`${body}\\n\\nApprove: ${link("approve")}\\nDecline: ${link("decline")}\``. Do not change it.)

- [ ] **Step 4: `sendReservationConfirmed` — replace its `html:`**

Keep the existing `const body = [...]`. Replace the `sendEmail` call's `html`:

```ts
  const itemRows = input.lines.map((l) => ({
    label: `${l.quantity}× ${l.productName}`,
    amount: formatPrice(l.priceCents * l.quantity),
  }));
  const html = renderEmail({
    preheader: `Your ${site.name} pickup reservation is confirmed`,
    eyebrow: "Reservation confirmed",
    heading: `You're confirmed, ${input.customerName}! 🍞`,
    bodyHtml:
      infoCard(
        `Pay <strong>${formatPrice(input.totalCents)}</strong> at pickup (cash or card) · ` +
          `pickup ${escapeHtml(when(input))} in ${escapeHtml(site.city)}.`,
        "sage",
      ) +
      lineItemsTable(itemRows, {
        label: "Total at pickup",
        amount: formatPrice(input.totalCents),
      }),
  });
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — pickup reservation confirmed`,
      html,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] confirmed send failed", err);
  }
```

> Note: `renderEmail` runs `escapeHtml` on `heading`, so the heading must use a **literal apostrophe** (`You're`), NOT the entity `You&#39;re` — escaping a literal `'` yields `&#39;` (correct, renders as `'`), but escaping the entity `&#39;` yields `&amp;#39;` (renders as the visible text `&#39;`). Static text inside `infoCard`/`bodyHtml` (which are NOT escaped) may use either; prefer literal apostrophes there too for consistency.

- [ ] **Step 5: `sendReservationDeclined` — replace its `html:`**

Keep the existing `const why = ...` and `const body = [...]`. Replace the `sendEmail` call's `html`:

```ts
  const html = renderEmail({
    preheader: `${site.name} reservation update`,
    eyebrow: "Reservation update",
    heading: `Sorry, ${input.customerName}`,
    bodyHtml:
      `<p style="margin:0 0 12px;">Unfortunately ${escapeHtml(why)}.</p>` +
      `<p style="margin:0;">No charge was made. Catch the next ${escapeHtml(
        site.name,
      )} drop!</p>`,
  });
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — reservation update`,
      html,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] declined send failed", err);
  }
```

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`, 28 pass), `npm run build` (succeeds).

```bash
git add src/lib/reservation-email.ts
git commit -m "feat: restyle the 4 reservation emails on shared shell"
```

---

### Task 4: Re-skin `club-confirmation-email.ts`

**Files:**
- Modify: `src/lib/club-confirmation-email.ts`

Keep `buildClubConfirmation`'s signature, the `subject`, the `text`, and all the date/label computation EXACTLY. Replace only the big `const html = \`<!doctype html>…\`` template, and remove the local `escapeHtml`/`escapeAttr` (use the shared `escapeHtml`).

- [ ] **Step 1: Swap imports + drop local escapers**

Current top:

```ts
import { site } from "./site";
```

Replace with:

```ts
import { emailButton, escapeHtml, infoCard, renderEmail } from "./email-layout";
import { site } from "./site";
```

Then DELETE the `function escapeHtml(...)` and `function escapeAttr(...)` blocks at the bottom of the file.

- [ ] **Step 2: Replace the `html` construction**

Replace the entire `const html = \`<!doctype html> … \`;` assignment with:

```ts
  const html = renderEmail({
    preheader: `Your ${flavorName} loaf is reserved · ${dropTitle}`,
    eyebrow: "Bread Club",
    heading: "Your loaf is reserved 🍞",
    bodyHtml:
      `<p style="margin:0 0 4px;">Thanks for picking <strong>${escapeHtml(
        flavorName,
      )}</strong> for the <strong>${escapeHtml(dropTitle)}</strong> drop${
        dateLabel ? ` (<strong>${escapeHtml(dateLabel)}</strong>)` : ""
      }.</p>` +
      infoCard(
        `<p style="margin:0 0 6px;"><strong>Flavor:</strong> ${escapeHtml(
          flavorName,
        )}</p>` +
          `<p style="margin:0 0 6px;"><strong>Fulfillment:</strong> ${escapeHtml(
            fulfillmentLabel,
          )}</p>` +
          (dateLabel
            ? `<p style="margin:0;"><strong>Drop date:</strong> ${escapeHtml(
                dateLabel,
              )}</p>`
            : ""),
      ) +
      `<p style="margin:14px 0 0;">${escapeHtml(fulfillmentNote)}</p>` +
      (shippingLine
        ? `<p style="margin:10px 0 0;">${escapeHtml(shippingLine)}</p>`
        : "") +
      `<p style="margin:20px 0 0;">${emailButton(
        selfServeUrl,
        "Change my pick",
        "primary",
      )}</p>` +
      `<p style="margin:12px 0 0;font-size:13px;color:#6c7150;">Open the button ` +
      `above any time before the drop opens to swap flavors or change ` +
      `pickup / ship.</p>`,
  });
```

(`flavorName`, `dropTitle`, `dateLabel`, `fulfillmentLabel`, `fulfillmentNote`, `shippingLine`, `selfServeUrl` are all already-declared locals in this function — unchanged. `subject` and `text` and the final `return { subject, html, text };` are unchanged.)

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck` (exit 0), `npm run lint` (exit 0), `npm test` (`# fail 0`, 28 pass), `npm run build` (succeeds).

```bash
git add src/lib/club-confirmation-email.ts
git commit -m "feat: re-skin Bread Club email on shared shell"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

Run: `npm run typecheck` (exit 0); `npm run lint` (exit 0); `npm test` (`# fail 0`, 28 pass: 12 drop-status + 4 reservation-token + 7 reservation-eval + 5 email-layout); `npm run build` (succeeds, all routes).

- [ ] **Step 2: No raw `<pre>` email bodies remain & escaper is shared**

Run: `git grep -nE "<pre[ >]" -- src/lib/order-email.ts src/lib/reservation-email.ts src/lib/club-confirmation-email.ts`
Expected: NO matches (all email HTML now goes through `renderEmail`).

Run: `git grep -n "function escapeHtml\|function esc\b\|function escapeAttr" -- src/lib`
Expected: the ONLY definition is in `src/lib/email-layout.ts`. The three composers no longer define local escapers (they import the shared one).

- [ ] **Step 3: Subjects / text / logic unchanged (diff inspection)**

`git diff` the three composer commits and confirm: no `subject:` string changed; no `text:` value changed; no `to:`/recipient changed; `signReservationToken`/`link()` logic in `reservation-email.ts` unchanged; `sendOrderEmails`/the four `send*`/`buildClubConfirmation` signatures unchanged. Only `html` construction and the escaper import differ. Report any deviation.

- [ ] **Step 4: Manual render check (state explicitly; NOT verified here)**

No headless browser / mail client here. Explicitly report this as **manual, not verified by this work**: after merge + deploy, trigger each of the 7 emails (a test order; a reservation request → baker links → confirm/decline; a Bread Club pick) and eyeball rendering in Gmail + Apple Mail (ideally Outlook). List the 7 emails as the manual checklist.

- [ ] **Step 5: Commit only if a fixup was required**

If nothing changed, skip. Otherwise:

```bash
git add -A -- src
git commit -m "chore: verification fixups for email restyle"
```

---

## Notes for the implementer

- **Only `html` changes.** Every `subject`, `to`, `text` body, and all
  send/sign/orchestration logic in the three composers is preserved
  byte-for-byte. If a step would change any of those, stop — it's wrong.
- **One escaper.** `escapeHtml` lives only in `email-layout.ts`; the three
  local copies (`escapeHtml`/`esc`/`escapeAttr`) are deleted and imported.
- **`renderEmail` escapes `preheader`/`eyebrow`/`heading`/`footerNote`**;
  `bodyHtml` is markup (NOT escaped) — callers escape customer-controlled
  values they put into `bodyHtml` with the shared `escapeHtml`. Do not
  double-escape values already handled by `renderEmail` (e.g. `heading`).
- **`lineItemsTable` escapes BOTH `label` and `amount` itself**; pass raw
  text (callers pass `formatPrice(...)` for `amount` — escaping is a no-op
  for currency strings and hardens the helper). Only `infoCard.innerHtml`
  and `renderEmail.bodyHtml` are markup (NOT escaped — callers escape).
- **node:test import rule:** `email-layout.ts` imports `./site.ts` (value
  import in a node-tested chain); the test imports `../email-layout.ts`. The
  three composers are server-only, not node-tested → keep their imports
  EXTENSIONLESS (`./email-layout`). Build-verified safe (run `npm run build`
  in each task).
- Emojis (🍞, ✅) are intentional brand accents — keep them.
- In `reservation-email.ts`, the identical `input.lines.map(...) → {label,amount}`
  appears in 3 functions — extract a private
  `function toItemRows(input: ReservationEmailInput) { return input.lines.map((l) => ({ label: \`${l.quantity}× ${l.productName}\`, amount: formatPrice(l.priceCents * l.quantity) })); }`
  and call it in received/baker/confirmed (declined has no item table). Pure
  refactor, no behavior change.
- Outlook may square button corners / Gmail strips `box-shadow`; the 2px
  forest border carries the card. No VML — accepted at this scale.
