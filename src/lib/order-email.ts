import "server-only";

import { sendEmail } from "./email";
import { formatPrice } from "./money";
import { site } from "./site";

/** One purchased line, as the customer was actually charged. */
export type OrderEmailLine = {
  name: string;
  quantity: number;
  /** Line total in cents (quantity already factored in). */
  amountCents: number;
};

export type OrderEmailInput = {
  /** Customer email (Stripe `customer_details.email`). */
  to: string;
  customerName?: string | null;
  /** Short human-facing order reference. */
  orderRef: string;
  lines: OrderEmailLine[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  isPickup: boolean;
  /** Shipping/billing state, for the baker notification + ship line. */
  shipState?: string | null;
};

function escapeHtml(s: string): string {
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

function fulfillmentText(input: OrderEmailInput): string {
  return input.isPickup
    ? `Local pickup in ${site.city} — we'll email you a pickup time.`
    : `Shipping within California${input.shipState ? ` to ${input.shipState}` : ""} — we'll follow up with tracking.`;
}

function customerHtml(input: OrderEmailInput): string {
  const rows = input.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${l.quantity}× ${escapeHtml(
          l.name,
        )}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${formatPrice(
          l.amountCents,
        )}</td></tr>`,
    )
    .join("");
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#283618">
    <h1 style="font-size:22px;margin:0 0 4px">Thanks${
      input.customerName ? `, ${escapeHtml(input.customerName)}` : ""
    } — your order is confirmed 🍞</h1>
    <p style="color:#6c7150;margin:0 0 16px">Order ${escapeHtml(input.orderRef)} · ${site.name}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      ${rows}
      <tr><td style="padding:8px 0">Subtotal</td><td style="padding:8px 0;text-align:right">${formatPrice(
        input.subtotalCents,
      )}</td></tr>
      <tr><td style="padding:2px 0">Shipping</td><td style="padding:2px 0;text-align:right">${
        input.shippingCents > 0 ? formatPrice(input.shippingCents) : "Free (pickup)"
      }</td></tr>
      <tr><td style="padding:8px 0;font-weight:700">Total</td><td style="padding:8px 0;text-align:right;font-weight:700">${formatPrice(
        input.totalCents,
      )}</td></tr>
    </table>
    <p style="margin:16px 0 4px">${fulfillmentText(input)}</p>
    <p style="color:#6c7150;font-size:13px;margin:16px 0 0">
      Everything is baked to order. ${site.cottageFood.madeIn}. ${site.cottageFood.permitNumber}.
      Questions? Just reply to this email.
    </p>
  </div>`;
}

function customerText(input: OrderEmailInput): string {
  const lines = input.lines
    .map((l) => `  ${l.quantity}x ${l.name} — ${formatPrice(l.amountCents)}`)
    .join("\n");
  return [
    `Thanks${input.customerName ? `, ${input.customerName}` : ""} — your order is confirmed.`,
    `Order ${input.orderRef} · ${site.name}`,
    "",
    lines,
    `  Subtotal: ${formatPrice(input.subtotalCents)}`,
    `  Shipping: ${input.shippingCents > 0 ? formatPrice(input.shippingCents) : "Free (pickup)"}`,
    `  Total: ${formatPrice(input.totalCents)}`,
    "",
    fulfillmentText(input),
    "",
    `Everything is baked to order. ${site.cottageFood.madeIn}. ${site.cottageFood.permitNumber}.`,
    "Questions? Just reply to this email.",
  ].join("\n");
}

function bakerText(input: OrderEmailInput): string {
  const lines = input.lines
    .map((l) => `  ${l.quantity}x ${l.name} — ${formatPrice(l.amountCents)}`)
    .join("\n");
  return [
    `New paid order ${input.orderRef} — ${formatPrice(input.totalCents)}`,
    `Customer: ${input.customerName ?? "(no name)"} <${input.to}>`,
    input.isPickup
      ? "Fulfillment: LOCAL PICKUP"
      : `Fulfillment: SHIP to ${input.shipState ?? "?"}`,
    "",
    lines,
    `  Total: ${formatPrice(input.totalCents)}`,
  ].join("\n");
}

/**
 * Best-effort order emails: a confirmation to the customer and a heads-up to
 * the baker. Each send is independent and never throws — the Stripe webhook
 * must still return 200 even if email delivery fails. Stripe can deliver
 * `checkout.session.completed` more than once, so a customer may, rarely,
 * receive a duplicate; acceptable at this volume (no event-id dedupe).
 */
export async function sendOrderEmails(input: OrderEmailInput): Promise<void> {
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
      html: `<pre style="font-family:ui-monospace,monospace;font-size:14px">${escapeHtml(
        bakerText(input),
      )}</pre>`,
      text: bakerText(input),
    });
  } catch (err) {
    console.error("[order-email] baker send failed", err);
  }
}
