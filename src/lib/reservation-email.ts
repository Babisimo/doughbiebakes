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
  /** Amount due at pickup — already the discounted amount when a promo applies. */
  totalCents: number;
  pickupDate?: string;
  /** Founding discount percent (present only when a promo applies). */
  promoPercentOff?: number;
  /** Pre-discount subtotal — present only when a promo applies, so emails can
   * show a subtotal → discount → total breakdown. */
  originalTotalCents?: number;
  /** Human-readable discount label from the reservation record (e.g. "Flash Sale −20%").
   * When present, used instead of the generic "Founding discount" wording. */
  discountLabel?: string;
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

/** True when this input carries a founding discount to display. */
function hasPromo(input: ReservationEmailInput): boolean {
  return (
    typeof input.promoPercentOff === "number" &&
    input.promoPercentOff > 0 &&
    typeof input.originalTotalCents === "number"
  );
}

/** HTML table rows: item lines, plus Subtotal + discount rows when a promo
 * applies — so the discount shows as a line BEFORE the bold total row. */
function breakdownRows(input: ReservationEmailInput): { label: string; amount: string }[] {
  const rows = toItemRows(input);
  const orig = input.originalTotalCents;
  const pct = input.promoPercentOff;
  if (typeof orig === "number" && typeof pct === "number" && pct > 0) {
    rows.push({ label: "Subtotal", amount: formatPrice(orig) });
    const discountLabel = input.discountLabel ?? `Founding discount (${pct}% off)`;
    rows.push({
      label: discountLabel,
      amount: `−${formatPrice(orig - input.totalCents)}`,
    });
  }
  return rows;
}

/** Plain-text breakdown: item lines, plus Subtotal + discount when a promo applies. */
function breakdownText(input: ReservationEmailInput): string {
  const itemLines = lines(input.lines);
  const orig = input.originalTotalCents;
  const pct = input.promoPercentOff;
  if (typeof orig === "number" && typeof pct === "number" && pct > 0) {
    const discountLabel = input.discountLabel ?? `Founding discount (${pct}% off)`;
    return [
      itemLines,
      `  Subtotal: ${formatPrice(orig)}`,
      `  ${discountLabel}: −${formatPrice(orig - input.totalCents)}`,
    ].join("\n");
  }
  return itemLines;
}

/** Submit-stage note: the discount isn't locked in until the baker approves
 * the reservation. Empty when no promo applies. */
function pendingDiscountText(input: ReservationEmailInput): string {
  if (!hasPromo(input)) return "";
  const label = input.discountLabel ? `${input.promoPercentOff}% flash-sale discount` : `${input.promoPercentOff}% founding discount`;
  return `\n\nYour ${label} is applied when we approve your reservation.`;
}
function pendingDiscountHtml(input: ReservationEmailInput): string {
  if (!hasPromo(input)) return "";
  const label = input.discountLabel ? `${input.promoPercentOff}% flash-sale discount` : `${input.promoPercentOff}% founding discount`;
  return (
    `<p style="margin:12px 0 0;font-size:13px;color:#6b705c;">Your ` +
    `<strong>${label}</strong> ` +
    `is applied when we approve your reservation.</p>`
  );
}

/** (a) Customer: request received, not yet confirmed. */
export async function sendReservationReceived(input: ReservationEmailInput): Promise<void> {
  const body =
    [
      `Thanks ${input.customerName} — we got your pickup reservation request.`,
      `It is NOT confirmed yet; ${site.name} will email you once it's approved.`,
      "",
      breakdownText(input),
      `  Total due at pickup: ${formatPrice(input.totalCents)}`,
      "",
      `Pickup in ${site.city} on ${when(input)}. ${site.cottageFood.madeIn}.`,
    ].join("\n") + pendingDiscountText(input);
  const html = renderEmail({
    preheader: `We received your ${site.name} pickup reservation request`,
    eyebrow: "Reservation requested",
    heading: `Thanks ${input.customerName} — request received`,
    bodyHtml:
      infoCard(
        "It's not confirmed yet — we'll email you once it's approved.",
      ) +
      lineItemsTable(breakdownRows(input), {
        label: "Total due at pickup",
        amount: formatPrice(input.totalCents),
      }) +
      pendingDiscountHtml(input) +
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
  const body =
    [
      `Hi ${input.customerName} — one quick step to lock in your ${site.name} pickup reservation.`,
      "",
      `Confirm it here: ${verifyUrl}`,
      "",
      breakdownText(input),
      `  Total due at pickup: ${formatPrice(input.totalCents)}`,
      "",
      "If you didn't request this, just ignore this email — nothing was reserved.",
    ].join("\n") + pendingDiscountText(input);
  const html = renderEmail({
    preheader: `Confirm your ${site.name} pickup reservation`,
    eyebrow: "Confirm your reservation",
    heading: `One tap to confirm, ${input.customerName}`,
    bodyHtml:
      infoCard("Your reservation isn't in our queue until you confirm it.") +
      lineItemsTable(breakdownRows(input), {
        label: "Total due at pickup",
        amount: formatPrice(input.totalCents),
      }) +
      pendingDiscountHtml(input) +
      `<p style="margin:18px 0 0;">` +
      emailButton(verifyUrl, "✅ Confirm my reservation", "primary") +
      `</p>` +
      `<p style="margin:14px 0 0;font-size:13px;color:#6b705c;">` +
      `Didn't request this? Ignore this email — nothing was reserved.</p>`,
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
    breakdownText(input),
  ].join("\n");
  const html = renderEmail({
    preheader: `New pickup reservation — ${formatPrice(input.totalCents)}`,
    eyebrow: "New pickup reservation",
    heading: `${input.customerName} · ${formatPrice(input.totalCents)}`,
    bodyHtml:
      `<p style="margin:0 0 6px;">${escapeHtml(input.customerName)} &lt;${escapeHtml(
        input.customerEmail,
      )}&gt;</p>` +
      `<p style="margin:0 0 12px;">${escapeHtml(input.customerPhone)}</p>` +
      lineItemsTable(breakdownRows(input), {
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
    breakdownText(input),
    `  Pay at pickup: ${formatPrice(input.totalCents)} (cash or card)`,
    "",
    `Pickup in ${site.city} on ${when(input)}. ${site.cottageFood.madeIn}. ${site.cottageFood.permitNumber}.`,
  ].join("\n");
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
      lineItemsTable(breakdownRows(input), {
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
