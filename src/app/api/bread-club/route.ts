import "server-only";

import { getActiveMemberCount, getMemberByEmail } from "@/lib/catalog";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Starts a Bread Club join — a Stripe `setup`-mode Checkout that saves a card
 * on file (charges nothing). The webhook creates the member on completion.
 * Per-drop $10 charges happen later, when the baker runs a drop.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return Response.json(
      { error: "Bread Club isn't open for sign-ups online yet." },
      { status: 503 },
    );
  }

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    body = {};
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return Response.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  // Dedup: an ACTIVE member with this email already exists → don't re-join.
  // (A previously canceled member with this email may rejoin.)
  // NOTE: race window — the member doc is written by the webhook, not here, so
  // two near-simultaneous joins for the same email can both open a Checkout
  // before either doc exists. Acceptable at 5-seat manual-club scale.
  const existing = await getMemberByEmail(email, { fresh: true });
  if (existing && existing.status === "active") {
    return Response.json({
      alreadyMember: true,
      message:
        "You're already a Bread Club member with that email. Use the manage link in any of our emails to update your card or leave the club.",
    });
  }

  // Server-side seat cap.
  const memberCount = await getActiveMemberCount({ fresh: true });
  if (memberCount !== null && memberCount >= site.breadClub.seats) {
    return Response.json(
      {
        error: `The Bread Club is full (${site.breadClub.seats} members). Email ${site.email} to join the waitlist.`,
      },
      { status: 409 },
    );
  }

  const base = siteUrl();
  try {
    // Pre-create the Customer so `session.customer` is always populated in the
    // setup-completed webhook. On API 2026-04-22.dahlia, passing
    // `customer_email` alone to a setup-mode session does not reliably create a
    // Customer — `session.customer` arrives null and the member never gets
    // saved. Pre-creating is deterministic.
    const customer = await stripe.customers.create({ email });
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer: customer.id,
      payment_method_types: ["card"],
      metadata: { kind: "club-join" },
      custom_text: {
        submit: {
          message: `Save your card for ${site.name}'s Bread Club. You're charged $10 only on weeks we bake — skip any drop you don't want.`,
        },
      },
      success_url: `${base}/order/success?session_id={CHECKOUT_SESSION_ID}&club=1`,
      cancel_url: `${base}/bread-club`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[bread-club] Stripe error:", err);
    return Response.json(
      { error: "Could not start sign-up. Please try again." },
      { status: 502 },
    );
  }
}
