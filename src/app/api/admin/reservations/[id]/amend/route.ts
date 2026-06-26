import { getAdminSession } from "@/lib/admin-auth";
import { computeSaleTotals, recomputeAmendedSale } from "@/lib/favors";
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

  // In-person sales support quantity edits: re-apply the stored flash discount
  // to the new subtotal and reconcile drop stock. Online reservations keep the
  // existing price-only path untouched (no quantity/stock/discount changes).
  const existing = newItems ? await getReservationForAmend(id) : null;

  let ok: boolean;
  if (newItems && existing?.channel === "in-person") {
    const sale = recomputeAmendedSale(newItems, existing.promoPercentOff);
    // collectedCents: an explicit number is the baker's override; otherwise the
    // discounted total (or unset → falls back to the full total when no sale).
    const collectedCents =
      typeof parsed.value.collectedCents === "number"
        ? parsed.value.collectedCents
        : sale.collectedCents ?? null;

    ok = await updateReservationPricing(id, {
      items: cleanItems,
      totalCents: sale.totalCents,
      collectedCents,
      // number ⇒ set; null ⇒ unset a now-irrelevant discount.
      discountedTotalCents: sale.discountedTotalCents ?? null,
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
