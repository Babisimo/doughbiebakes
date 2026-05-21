import { getActiveMemberCount, getMemberByEmail } from "@/lib/catalog";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Starts a recurring "Bread Club" subscription checkout. Requires
 * STRIPE_BREAD_CLUB_PRICE_ID (a recurring Price created in the Stripe
 * dashboard — recommended: $40.00 every 4 weeks, see docs/STRIPE.md). Without
 * it the Bread Club page falls back to a waitlist email instead of this button.
 * (Enable Stripe's Customer Portal so members get a working pause/cancel link.)
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_BREAD_CLUB_PRICE_ID;
  if (!stripe || !priceId) {
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

  // Dedup check: if this email already has an active membership in the cache,
  // don't open Checkout — tell the caller to manage their existing one
  // instead. Keeps a member from accidentally double-paying.
  const existing = await getMemberByEmail(email, { fresh: true });
  if (
    existing &&
    (existing.status === "active" ||
      existing.status === "trialing" ||
      existing.status === "past_due")
  ) {
    return Response.json({
      alreadyMember: true,
      message:
        "We found a Bread Club membership for that email. Check your Stripe payment receipts for the 'manage subscription' link — it's a tap away from pause / cancel / update card.",
    });
  }

  // Server-side cap. The /bread-club page already hides the Join button when
  // we're full, but a stale tab or a curl request could still hit this — so
  // re-check the Sanity member cache before opening Checkout.
  const memberCount = await getActiveMemberCount({ fresh: true });
  if (memberCount !== null && memberCount >= site.breadClub.seats) {
    return Response.json(
      {
        error: `The Bread Club is full (${site.breadClub.seats} members). Email ${site.email} to join the waitlist — we'll text the moment a seat opens.`,
      },
      { status: 409 },
    );
  }

  const base = siteUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Pre-fill + lock the email we just checked. Stripe Checkout still
      // creates a fresh Customer record under the hood; the dedup that
      // matters happens up above against our Sanity cache.
      customer_email: email,
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true,
      custom_text: {
        submit: {
          message: `Standing weekly loaf from ${site.name}. Pause or cancel anytime from the link in your receipt.`,
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
