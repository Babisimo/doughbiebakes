import { getAdminSession } from "@/lib/admin-auth";
import { computeSaleTotals } from "@/lib/favors";
import { parseAmendBody } from "@/lib/reservation-amend";
import { updateReservationPricing } from "@/sanity/lib/mutations";

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

  // Recompute the total from amended item prices (same helper the in-person
  // sale form uses); favorsCents is ignored here.
  const totalCents = parsed.value.items
    ? computeSaleTotals(parsed.value.items).totalCents
    : undefined;

  const ok = await updateReservationPricing(id, {
    items: parsed.value.items?.map(({ productSlug, productName, quantity, priceCents }) => ({
      productSlug,
      productName,
      quantity,
      priceCents,
    })),
    totalCents,
    collectedCents: parsed.value.collectedCents,
  });

  if (!ok) {
    return Response.json(
      { error: "Saving isn't configured (no Sanity write token)." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}
