import "server-only";

import { getMemberByEmail } from "@/lib/catalog";
import { verifyClubToken } from "@/lib/club-token";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

/**
 * Opens a Stripe Customer Portal session for a Bread Club member. The form on
 * /club/[dropId] POSTs here with the same email + token + dropId that
 * authenticates the member's selection page; we re-verify the magic-link
 * token and then redirect to a Stripe-hosted page where they can update
 * their card, pause, or cancel.
 *
 * Requires the Customer Portal to be activated in Stripe (Dashboard →
 * Settings → Customer Portal → Activate).
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("token") ?? "");
  const dropId = String(form.get("dropId") ?? "");

  if (!email || !token || !dropId || !verifyClubToken(email, dropId, token)) {
    return new Response("Invalid or expired link.", { status: 403 });
  }

  const member = await getMemberByEmail(email, { fresh: true });
  if (!member?.stripeCustomerId) {
    return new Response(
      "We couldn't find an active subscription for that email. If you just signed up, give it a minute and reload.",
      { status: 404 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return new Response("Payments aren't configured.", { status: 503 });
  }

  const returnUrl = `${siteUrl()}/club/${dropId}?email=${encodeURIComponent(email)}&token=${token}`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: member.stripeCustomerId,
      return_url: returnUrl,
    });
    return Response.redirect(session.url, 303);
  } catch (err) {
    console.error("[club/portal] Stripe portal session failed:", err);
    return new Response(
      "Could not open the subscription portal — please try again, or reply to your Bread Club emails for help.",
      { status: 502 },
    );
  }
}
