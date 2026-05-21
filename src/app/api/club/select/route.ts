import "server-only";

import { getActiveDrop, getMemberByEmail, getMemberSelectionsForDrop } from "@/lib/catalog";
import { buildClubConfirmation } from "@/lib/club-confirmation-email";
import { signClubToken, verifyClubToken } from "@/lib/club-token";
import { effectiveDropStatus } from "@/lib/drop-status";
import { sendEmail } from "@/lib/email";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/url";
import { upsertMemberSelection } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

type Body = {
  dropId?: unknown;
  email?: unknown;
  token?: unknown;
  productSlug?: unknown;
  fulfillment?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad JSON body." }, { status: 400 });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const token = typeof body.token === "string" ? body.token : "";
  const productSlug = typeof body.productSlug === "string" ? body.productSlug : "";
  const fulfillment =
    body.fulfillment === "ship" ? "ship" : "pickup"; // default to pickup

  if (!dropId || !email || !token || !productSlug) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!verifyClubToken(email, dropId, token)) {
    return Response.json({ error: "Invalid or expired link." }, { status: 403 });
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id !== dropId) {
    return Response.json(
      { error: "This drop is no longer the active one." },
      { status: 409 },
    );
  }
  if (effectiveDropStatus(drop, new Date()) !== "announced") {
    return Response.json(
      { error: "The member selection window for this drop is closed." },
      { status: 409 },
    );
  }
  const line = drop.lineItems.find((li) => li.product.slug === productSlug);
  if (!line) {
    return Response.json(
      { error: "That loaf isn't part of this drop." },
      { status: 409 },
    );
  }

  const selections = await getMemberSelectionsForDrop(drop, { fresh: true });
  const claimedByOthers = selections.filter(
    (s) => s.productSlug === productSlug && s.customerEmail !== email,
  ).length;
  const totalForSlug = Math.max(0, Math.floor(line.quantity ?? 0));
  if (claimedByOthers >= totalForSlug) {
    return Response.json(
      { error: "Another member just claimed the last one — please pick another flavor." },
      { status: 409 },
    );
  }

  // --- Shipping surcharge: queue / clear a pending Stripe invoice item ------
  // Picking "ship" adds a one-time line to the member's NEXT subscription
  // invoice. Switching back to "pickup" deletes that pending line so they
  // aren't charged. Scoped per (drop, email) via the memberSelection doc.
  // TODO(BC.T13): shipping surcharge will be re-wired for per-drop billing.
  const priorSelection = selections.find((s) => s.customerEmail === email);
  const priorShipItemId = priorSelection?.shipInvoiceItemId ?? null;

  const stripe = getStripe();
  const member = await getMemberByEmail(email, { fresh: true });
  const stripeCustomerId = member?.stripeCustomerId;

  if (stripe && stripeCustomerId) {
    if (fulfillment === "ship" && !priorShipItemId) {
      try {
        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          amount: site.breadClub.shipSurchargeCents,
          currency: "usd",
          description: `Bread Club shipping — ${drop.title}`,
        });
      } catch (err) {
        console.error("[club/select] failed to queue shipping invoice item:", err);
      }
    } else if (fulfillment === "pickup" && priorShipItemId) {
      try {
        await stripe.invoiceItems.del(priorShipItemId);
      } catch (err) {
        // Already swept onto a finalized invoice — can't delete. Baker may
        // need to refund manually.
        console.error(
          "[club/select] could not delete shipping invoice item (already invoiced?):",
          err,
        );
      }
    }
    // ship + already has an item, or pickup + nothing to clear → no-op.
  } else if (fulfillment === "ship") {
    console.warn(
      `[club/select] ${email} chose ship but no Stripe customer in cache — shipping NOT billed. Reconcile manually.`,
    );
  }

  const wrote = await upsertMemberSelection({
    dropId,
    email,
    productSlug,
    fulfillment,
    skipped: false,
  });
  if (!wrote) {
    return Response.json(
      { error: "Selections can't be saved — Sanity write client isn't configured." },
      { status: 503 },
    );
  }

  // Fire-and-await the confirmation email. We log + swallow on failure so a
  // flaky Resend doesn't keep a member from saving their pick.
  const freshToken = signClubToken(email, drop.id);
  const selfServeUrl = `${siteUrl()}/club/${drop.id}?email=${encodeURIComponent(email)}&token=${freshToken}`;
  const message = buildClubConfirmation({
    flavorName: line.product.name,
    fulfillment,
    dropTitle: drop.title,
    pickupOrShipDate: drop.pickupOrShipDate,
    selfServeUrl,
    shipSurchargeLabel:
      fulfillment === "ship"
        ? formatPrice(site.breadClub.shipSurchargeCents)
        : undefined,
  });
  const emailSent = await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  return Response.json({ ok: true, productSlug, fulfillment, emailSent });
}
