import { markReservationVerified } from "@/sanity/lib/mutations";
import { verifyReservationToken } from "@/lib/reservation-token";
import { sanityClient } from "@/sanity/client";
import { RESERVATION_BY_ID_QUERY, DROP_BY_ID_QUERY } from "@/sanity/lib/queries";
import {
  sendReservationBakerAlert,
  sendReservationReceived,
} from "@/lib/reservation-email";
import { siteUrl } from "@/lib/url";

export const runtime = "nodejs";

const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#283618">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!id || !verifyReservationToken(id, "verify", token)) {
    return page("Invalid link", "This confirmation link is invalid.");
  }

  const moved = await markReservationVerified(id);
  if (!moved) {
    // Already verified/decided, or not configured — idempotent friendly page.
    return page(
      "Already confirmed",
      "This reservation is already confirmed — we'll email you once the baker approves it.",
    );
  }

  // Now that it's a real (human-confirmed) request, surface it to the baker.
  if (fresh) {
    try {
      const r = await fresh.fetch<{
        id: string;
        customerName: string;
        customerEmail: string;
        customerPhone: string;
        dropId: string;
        totalCents: number;
        promoCode?: string;
        promoPercentOff?: number;
        discountedTotalCents?: number;
        items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
      } | null>(RESERVATION_BY_ID_QUERY, { id });
      if (r) {
        const drop = await fresh.fetch<{ pickupOrShipDate?: string } | null>(
          DROP_BY_ID_QUERY,
          { id: r.dropId },
        );
        const promoApplies =
          !!r.promoCode && typeof r.discountedTotalCents === "number";
        const emailInput = {
          id: r.id,
          customerName: r.customerName,
          customerEmail: r.customerEmail,
          customerPhone: r.customerPhone,
          lines: r.items.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            priceCents: i.priceCents,
          })),
          totalCents:
            typeof r.discountedTotalCents === "number" && r.promoCode
              ? r.discountedTotalCents
              : r.totalCents,
          originalTotalCents: promoApplies ? r.totalCents : undefined,
          promoPercentOff: r.promoCode ? r.promoPercentOff : undefined,
          pickupDate: drop?.pickupOrShipDate,
        };
        await sendReservationReceived(emailInput);
        await sendReservationBakerAlert(emailInput);
      }
    } catch (err) {
      console.error("[reservations/verify] post-verify notify failed", err);
    }
  }

  return Response.redirect(new URL("/reserve/received", siteUrl()), 303);
}
