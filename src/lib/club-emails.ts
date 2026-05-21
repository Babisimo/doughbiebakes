import "server-only";

import { signClubMemberToken } from "./club-token";
import { sendEmail } from "./email";
import { emailButton, infoCard, renderEmail } from "./email-layout";
import { site } from "./site";
import { siteUrl } from "./url";

/**
 * Customer email sent when an off-session per-drop charge declines — nudges
 * them to update their card. Best-effort: logs + swallows its own errors.
 */
export async function sendClubDeclineEmail(input: {
  to: string;
  stripeCustomerId: string;
}): Promise<void> {
  const token = signClubMemberToken(input.stripeCustomerId);
  const updateUrl = `${siteUrl()}/api/club/update-card?customer=${encodeURIComponent(
    input.stripeCustomerId,
  )}&token=${token}`;
  const text = [
    `Hi — your card was declined for this week's ${site.name} Bread Club drop.`,
    "",
    `Update your card to stay in the club: ${updateUrl}`,
    "",
    "Once it's updated we'll re-run the charge. No loaf is held until payment goes through.",
  ].join("\n");
  const html = renderEmail({
    preheader: `Update your ${site.name} Bread Club card`,
    eyebrow: "Card declined",
    heading: "Your Bread Club card needs an update",
    bodyHtml:
      infoCard(
        "Your card was declined for this week's drop. Update it and we'll " +
          "re-run the charge — no loaf is held until payment goes through.",
      ) +
      `<p style="margin:18px 0 0;">` +
      emailButton(updateUrl, "Update my card", "primary") +
      `</p>`,
  });
  try {
    await sendEmail({
      to: input.to,
      subject: `${site.name} — your Bread Club card was declined`,
      html,
      text,
    });
  } catch (err) {
    console.error("[club-emails] decline send failed", err);
  }
}
