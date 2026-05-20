import { getPromoByCode, isRedeemable } from "@/lib/promo";

export const runtime = "nodejs";

/**
 * Public promo-code check. Lets the storefront show a live discounted total on
 * /cart and /reserve before checkout. Read-only — it never touches the
 * redemption counter; /api/checkout and /api/reserve stay authoritative.
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!code.trim()) return Response.json({ valid: false, percentOff: 0 });
  const promo = await getPromoByCode(code);
  return isRedeemable(promo)
    ? Response.json({ valid: true, percentOff: promo.percentOff })
    : Response.json({ valid: false, percentOff: 0 });
}
