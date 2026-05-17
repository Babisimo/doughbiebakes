import "server-only";

import { sendEmail } from "./email";
import { escapeHtml, infoCard, lineItemsTable, renderEmail } from "./email-layout";
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


function fulfillmentText(input: OrderEmailInput): string {
  return input.isPickup
    ? `Local pickup in ${site.city} — we'll email you a pickup time.`
    : `Shipping within California${input.shipState ? ` to ${input.shipState}` : ""} — we'll follow up with tracking.`;
}

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
      html: bakerHtml(input),
      text: bakerText(input),
    });
  } catch (err) {
    console.error("[order-email] baker send failed", err);
  }
}
