import "server-only";

import { sendEmail } from "./email";
import { formatPrice } from "./money";
import { signReservationToken } from "./reservation-token";
import { site } from "./site";
import { siteUrl } from "./url";

export type ReservationLine = { productName: string; quantity: number; priceCents: number };
export type ReservationEmailInput = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lines: ReservationLine[];
  totalCents: number;
  pickupDate?: string;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
function lines(ls: ReservationLine[]): string {
  return ls
    .map((l) => `  ${l.quantity}x ${l.productName} — ${formatPrice(l.priceCents * l.quantity)}`)
    .join("\n");
}
function when(input: ReservationEmailInput): string {
  return input.pickupDate
    ? new Date(input.pickupDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "the drop date";
}

/** (a) Customer: request received, not yet confirmed. */
export async function sendReservationReceived(input: ReservationEmailInput): Promise<void> {
  const body = [
    `Thanks ${input.customerName} — we got your pickup reservation request.`,
    `It is NOT confirmed yet; ${site.name} will email you once it's approved.`,
    "",
    lines(input.lines),
    `  Total due at pickup: ${formatPrice(input.totalCents)}`,
    "",
    `Pickup in ${site.city} on ${when(input)}. ${site.cottageFood.madeIn}.`,
  ].join("\n");
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — reservation request received`,
      html: `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>`,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] received send failed", err);
  }
}

/** (b) Baker: new request with signed Approve/Decline links. */
export async function sendReservationBakerAlert(input: ReservationEmailInput): Promise<void> {
  const base = siteUrl();
  const link = (action: "approve" | "decline") =>
    `${base}/api/reservations/decide?id=${encodeURIComponent(input.id)}&action=${action}&token=${signReservationToken(input.id, action)}`;
  const body = [
    `New pickup reservation — ${formatPrice(input.totalCents)} due at pickup`,
    `${input.customerName} <${input.customerEmail}> ${input.customerPhone}`,
    "",
    lines(input.lines),
  ].join("\n");
  const html =
    `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>` +
    `<p><a href="${link("approve")}">✅ Approve &amp; hold stock</a> &nbsp;|&nbsp; ` +
    `<a href="${link("decline")}">❌ Decline</a></p>`;
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
}

/** (c) Customer: confirmed — pay at pickup. */
export async function sendReservationConfirmed(input: ReservationEmailInput): Promise<void> {
  const body = [
    `You're confirmed, ${input.customerName}! 🍞`,
    "",
    lines(input.lines),
    `  Pay at pickup: ${formatPrice(input.totalCents)} (cash or card)`,
    "",
    `Pickup in ${site.city} on ${when(input)}. ${site.cottageFood.madeIn}. ${site.cottageFood.permitNumber}.`,
  ].join("\n");
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — pickup reservation confirmed`,
      html: `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>`,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] confirmed send failed", err);
  }
}

/** (d) Customer: declined / no longer available. */
export async function sendReservationDeclined(
  input: ReservationEmailInput,
  reason: "declined" | "soldout" | "unavailable",
): Promise<void> {
  const why =
    reason === "soldout"
      ? "those loaves sold out before we could confirm"
      : reason === "unavailable"
        ? "that drop has closed"
        : "we couldn't fulfill this reservation this time";
  const body = [
    `Hi ${input.customerName} — sorry, ${why}.`,
    `No charge was made. Catch the next ${site.name} drop!`,
  ].join("\n");
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — reservation update`,
      html: `<pre style="font:14px ui-monospace,monospace">${esc(body)}</pre>`,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] declined send failed", err);
  }
}
