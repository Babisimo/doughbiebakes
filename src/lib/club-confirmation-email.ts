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

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#fbf7ef;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#241804;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf7ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border:2px solid #241804;border-radius:18px;box-shadow:6px 6px 0 0 #241804;">
            <tr>
              <td style="padding:28px 28px 8px;">
                <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#7a6c4f;">${escapeHtml(site.name)} · Bread Club</p>
                <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;color:#241804;">Your loaf is reserved 🍞</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 20px;font-size:15px;line-height:1.55;color:#241804;">
                <p style="margin:0 0 16px;">
                  Thanks for picking <strong>${escapeHtml(flavorName)}</strong> for the
                  <strong>${escapeHtml(dropTitle)}</strong> drop${dateLabel ? ` (<strong>${escapeHtml(dateLabel)}</strong>)` : ""}.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#fff8e7;border:1px solid #f0d36a;border-radius:12px;">
                  <tr>
                    <td style="padding:14px 18px;font-size:14px;">
                      <p style="margin:0 0 6px;"><strong>Flavor:</strong> ${escapeHtml(flavorName)}</p>
                      <p style="margin:0 0 6px;"><strong>Fulfillment:</strong> ${escapeHtml(fulfillmentLabel)}</p>
                      ${dateLabel ? `<p style="margin:0;"><strong>Drop date:</strong> ${escapeHtml(dateLabel)}</p>` : ""}
                    </td>
                  </tr>
                </table>
                <p style="margin:18px 0 0;font-size:14px;color:#5b4d2c;">${escapeHtml(fulfillmentNote)}</p>
                ${shippingLine ? `<p style="margin:10px 0 0;font-size:14px;color:#5b4d2c;">${escapeHtml(shippingLine)}</p>` : ""}
                <p style="margin:22px 0 0;">
                  <a href="${escapeAttr(selfServeUrl)}" style="display:inline-block;padding:10px 18px;background:#a8d955;border:2px solid #241804;border-radius:9999px;color:#241804;font-weight:700;text-decoration:none;">
                    Change my pick
                  </a>
                </p>
                <p style="margin:14px 0 0;font-size:12px;color:#7a6c4f;">
                  Open the button above any time before the drop opens to swap flavors or change pickup / ship.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 24px;border-top:1px solid #f0e2bf;font-size:12px;color:#7a6c4f;">
                Sent by ${escapeHtml(site.name)} · ${escapeHtml(site.city)}.<br/>
                You're receiving this because you're an active Bread Club member.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  // For URLs going into href — already safe as long as we encode the same set.
  return escapeHtml(s);
}
