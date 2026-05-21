import { verifyClubMemberToken } from "@/lib/club-token";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

function errorPage(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Bread Club</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">Link problem</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customer = url.searchParams.get("customer") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!customer || !verifyClubMemberToken(customer, token)) {
    return errorPage("This card-update link is invalid.");
  }
  const stripe = getStripe();
  if (!stripe) return errorPage("Card updates aren't available right now.");

  const base = siteUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer,
      payment_method_types: ["card"],
      metadata: { kind: "club-card-update" },
      success_url: `${base}/order/success?session_id={CHECKOUT_SESSION_ID}&club=1`,
      cancel_url: `${base}/bread-club`,
    });
    if (!session.url) return errorPage("Could not start the card update.");
    return Response.redirect(session.url, 303);
  } catch (err) {
    console.error("[club/update-card] Stripe error:", err);
    return errorPage("Could not start the card update — please try again.");
  }
}
