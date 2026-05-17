import { emailButton, escapeHtml, infoCard, renderEmail } from "./email-layout";
import { site } from "./site";

/**
 * Build the "your loaf is reserved" email a member receives after picking a
 * flavor on /club. Keeps to inline styles + table-friendly markup so it
 * renders in Gmail / Apple Mail / Outlook without surprises.
 */
export function buildClubConfirmation(args: {
  flavorName: string;
  fulfillment: "pickup" | "ship";
  dropTitle: string;
  pickupOrShipDate?: string;
  selfServeUrl: string;
  /** e.g. "$12.00" — only passed when fulfillment === "ship". */
  shipSurchargeLabel?: string;
}): { subject: string; html: string; text: string } {
  const { flavorName, fulfillment, dropTitle, pickupOrShipDate, selfServeUrl, shipSurchargeLabel } =
    args;

  const shippingLine =
    fulfillment === "ship" && shipSurchargeLabel
      ? `Shipping (${shipSurchargeLabel}) will be added to your next Bread Club invoice — no extra checkout needed.`
      : null;

  const dateLabel = pickupOrShipDate
    ? new Date(pickupOrShipDate).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const fulfillmentLabel =
    fulfillment === "pickup"
      ? `Local pickup in ${site.city}`
      : "Shipping to the address on file with Stripe";

  const fulfillmentNote =
    fulfillment === "pickup"
      ? `We'll text you the pickup window a day or two before — usually a couple of hours on ${dateLabel ?? "drop day"}.`
      : `Your loaf will ship the day before ${dateLabel ?? "drop day"} so it's in your hands fresh.`;

  const subject = `Your ${flavorName} loaf is reserved · ${dropTitle}`;

  const text = [
    `Your ${flavorName} loaf is reserved.`,
    "",
    `Drop: ${dropTitle}${dateLabel ? ` · ${dateLabel}` : ""}`,
    `Flavor: ${flavorName}`,
    `Fulfillment: ${fulfillmentLabel}`,
    "",
    fulfillmentNote,
    ...(shippingLine ? ["", shippingLine] : []),
    "",
    `Want to change your pick? Open this link any time before the drop opens:`,
    selfServeUrl,
    "",
    `— ${site.name}`,
  ].join("\n");

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

  return { subject, html, text };
}
