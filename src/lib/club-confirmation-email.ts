import { emailButton, escapeHtml, infoCard, renderEmail } from "./email-layout";
import { site } from "./site";

/**
 * Build the confirmation email a member receives after selecting (or skipping)
 * a drop on /club. Keeps to inline styles + table-friendly markup so it
 * renders in Gmail / Apple Mail / Outlook without surprises.
 */
export function buildClubConfirmation(args: {
  skipped: boolean;
  flavorName: string | null;
  fulfillment: "pickup" | "ship";
  dropTitle: string;
  pickupOrShipDate?: string;
  selfServeUrl: string;
}): { subject: string; html: string; text: string } {
  const { skipped, flavorName, fulfillment, dropTitle, pickupOrShipDate, selfServeUrl } = args;

  const dateLabel = pickupOrShipDate
    ? new Date(pickupOrShipDate).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // --- SKIP branch ---
  if (skipped) {
    const subject = `You're skipping ${dropTitle} · Bread Club`;

    const text = [
      `You've skipped the ${dropTitle} drop.`,
      "",
      `Drop: ${dropTitle}${dateLabel ? ` · ${dateLabel}` : ""}`,
      "",
      `No loaf, no charge for this one. Changed your mind?`,
      `You can still pick a loaf while the selection window is open:`,
      selfServeUrl,
      "",
      `— ${site.name}`,
    ].join("\n");

    const html = renderEmail({
      preheader: `You're skipping ${dropTitle} — no charge this drop.`,
      eyebrow: "Bread Club",
      heading: "Drop skipped",
      bodyHtml:
        `<p style="margin:0 0 4px;">Got it — you're skipping the <strong>${escapeHtml(dropTitle)}</strong> drop${
          dateLabel ? ` (<strong>${escapeHtml(dateLabel)}</strong>)` : ""
        }. No loaf, no charge this round.</p>` +
        `<p style="margin:14px 0 0;">Changed your mind? You can still pick a loaf while the selection window is open.</p>` +
        `<p style="margin:20px 0 0;">${emailButton(
          selfServeUrl,
          "Pick a loaf instead",
          "primary",
        )}</p>` +
        `<p style="margin:12px 0 0;font-size:13px;color:#6c7150;">Open the button above any time before the drop opens to select a flavor.</p>`,
    });

    return { subject, html, text };
  }

  // --- PICK branch ---
  const flavor = flavorName ?? "";

  const fulfillmentLabel =
    fulfillment === "pickup"
      ? `Local pickup in ${site.city}`
      : "Shipping to the address on file with Stripe";

  const fulfillmentNote =
    fulfillment === "pickup"
      ? `We'll text you the pickup window a day or two before — usually a couple of hours on ${dateLabel ?? "drop day"}.`
      : `Your loaf will ship the day before ${dateLabel ?? "drop day"} so it's in your hands fresh.`;

  const subject = `Your ${flavor} loaf is reserved · ${dropTitle}`;

  const text = [
    `Your ${flavor} loaf is reserved.`,
    "",
    `Drop: ${dropTitle}${dateLabel ? ` · ${dateLabel}` : ""}`,
    `Flavor: ${flavor}`,
    `Fulfillment: ${fulfillmentLabel}`,
    "",
    fulfillmentNote,
    "",
    `Want to change your pick? Open this link any time before the drop opens:`,
    selfServeUrl,
    "",
    `— ${site.name}`,
  ].join("\n");

  const html = renderEmail({
    preheader: `Your ${flavor} loaf is reserved · ${dropTitle}`,
    eyebrow: "Bread Club",
    heading: "Your loaf is reserved 🍞",
    bodyHtml:
      `<p style="margin:0 0 4px;">Thanks for picking <strong>${escapeHtml(
        flavor,
      )}</strong> for the <strong>${escapeHtml(dropTitle)}</strong> drop${
        dateLabel ? ` (<strong>${escapeHtml(dateLabel)}</strong>)` : ""
      }.</p>` +
      infoCard(
        `<p style="margin:0 0 6px;"><strong>Flavor:</strong> ${escapeHtml(
          flavor,
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
