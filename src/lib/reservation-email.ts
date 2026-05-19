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

export type ReservationLine = { productName: string; quantity: number; priceCents: number };
export type ReservationEmailInput = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lines: ReservationLine[];
  totalCents: number;
  pickupDate?: string;
  promoPercentOff?: number;
};

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

function toItemRows(input: ReservationEmailInput) {
  return input.lines.map((l) => ({
    label: `${l.quantity}× ${l.productName}`,
    amount: formatPrice(l.priceCents * l.quantity),
  }));
}
function discountNoteText(input: ReservationEmailInput): string {
  return input.promoPercentOff
    ? `\n  (Founding discount: ${input.promoPercentOff}% off applied — total above is the discounted amount.)`
    : "";
}
function discountNoteHtml(input: ReservationEmailInput): string {
  return input.promoPercentOff
    ? `<p style="margin:10px 0 0;font-size:13px;color:#6b705c;">Founding discount: ` +
        `<strong>${input.promoPercentOff}% off</strong> applied — the total shown is the discounted amount.</p>`
    : "";
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
  const itemRows = toItemRows(input);
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
}

/** (a0) Customer: double opt-in — must click to confirm the request exists. */
export async function sendReservationVerify(input: ReservationEmailInput): Promise<void> {
  const base = siteUrl();
  const verifyUrl = `${base}/api/reservations/verify?id=${encodeURIComponent(
    input.id,
  )}&token=${signReservationToken(input.id, "verify")}`;
  const body = [
    `Hi ${input.customerName} — one quick step to lock in your ${site.name} pickup reservation.`,
    "",
    `Confirm it here: ${verifyUrl}`,
    "",
    lines(input.lines),
    `  Total due at pickup: ${formatPrice(input.totalCents)}`,
    "",
    "If you didn't request this, just ignore this email — nothing was reserved.",
    discountNoteText(input),
  ].join("\n");
  const itemRows = toItemRows(input);
  const html = renderEmail({
    preheader: `Confirm your ${site.name} pickup reservation`,
    eyebrow: "Confirm your reservation",
    heading: `One tap to confirm, ${input.customerName}`,
    bodyHtml:
      infoCard("Your reservation isn't in our queue until you confirm it.") +
      lineItemsTable(itemRows, {
        label: "Total due at pickup",
        amount: formatPrice(input.totalCents),
      }) +
      `<p style="margin:18px 0 0;">` +
      emailButton(verifyUrl, "✅ Confirm my reservation", "primary") +
      `</p>` +
      `<p style="margin:14px 0 0;font-size:13px;color:#6b705c;">` +
      `Didn't request this? Ignore this email — nothing was reserved.</p>` +
      discountNoteHtml(input),
  });
  try {
    await sendEmail({
      to: input.customerEmail,
      subject: `${site.name} — confirm your pickup reservation`,
      html,
      text: body,
    });
  } catch (err) {
    console.error("[reservation-email] verify send failed", err);
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
  const itemRows = toItemRows(input);
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
    discountNoteText(input),
  ].join("\n");
  const itemRows = toItemRows(input);
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
      }) +
      discountNoteHtml(input),
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
}
