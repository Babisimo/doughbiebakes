import { getAdminSession } from "@/lib/admin-auth";
import { computeSaleTotals } from "@/lib/favors";
import { parseAmendBody, stockDeltas } from "@/lib/reservation-amend";
import {
  adjustDropStock,
  getReservationForAmend,
  updateReservationPricing,
} from "@/sanity/lib/mutations";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return Response.json({ error: "Missing reservation id." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseAmendBody(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const newItems = parsed.value.items;
  const cleanItems = newItems?.map(({ productSlug, productName, quantity, priceCents }) => ({
    productSlug,
    productName,
    quantity,
    priceCents,
  }));

  // In-person sales support quantity edits and reconcile drop stock. Per-line
  // prices already reflect any flash sale (sale price baked in), so the total is
  // just what's charged. The stored promoPercentOff is left as-is. Online
  // reservations keep the existing price-only path untouched.
  const existing = newItems ? await getReservationForAmend(id) : null;

  let ok: boolean;
  if (newItems && existing?.channel === "in-person") {
    const { totalCents } = computeSaleTotals(newItems);
    // An explicit number is the baker's override; otherwise unset (falls back to
    // totalCents). Also unset any legacy discount-on-total field from old records.
    const collectedCents =
      typeof parsed.value.collectedCents === "number" ? parsed.value.collectedCents : null;

    ok = await updateReservationPricing(id, {
      items: cleanItems,
      totalCents,
      collectedCents,
      discountedTotalCents: null,
    });

    if (ok && existing.dropId) {
      const deltas = stockDeltas(existing.items, newItems);
      try {
        await adjustDropStock(existing.dropId, deltas);
      } catch (err) {
        console.error("[amend] PRICING SAVED BUT STOCK NOT RECONCILED", id, err);
      }
    }
  } else {
    const totalCents = newItems ? computeSaleTotals(newItems).totalCents : undefined;
    ok = await updateReservationPricing(id, {
      items: cleanItems,
      totalCents,
      collectedCents: parsed.value.collectedCents,
    });
  }

  if (!ok) {
    return Response.json(
      { error: "Saving isn't configured (no Sanity write token)." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}
