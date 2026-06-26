import { getAdminSession } from "@/lib/admin-auth";
import { getDropById } from "@/lib/catalog";
import { computeSaleTotals, type SaleLineInput } from "@/lib/favors";
import { flashSaleStatus } from "@/lib/flash-sale";
import { createInPersonSale } from "@/sanity/lib/mutations";

export const runtime = "nodejs";

const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const dropId = typeof body.dropId === "string" ? body.dropId.trim() : "";
  const customerName =
    typeof body.customerName === "string" ? body.customerName.trim() : "";
  if (!dropId) return Response.json({ error: "Missing drop." }, { status: 400 });
  if (!customerName) {
    return Response.json({ error: "A buyer name is required." }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: SaleLineInput[] = rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        productSlug: typeof o.productSlug === "string" ? o.productSlug : "",
        productName: typeof o.productName === "string" ? o.productName : "",
        quantity: int(o.quantity),
        priceCents: int(o.priceCents),
        listPriceCents: int(o.listPriceCents),
      };
    })
    .filter((i) => i.productSlug && i.quantity > 0);

  if (items.length === 0) {
    return Response.json(
      { error: "Add at least one loaf with a quantity." },
      { status: 400 },
    );
  }

  // Re-derive the flash sale from the drop itself (never trust a client-sent
  // percent), mirroring the public reserve route. A sale is gated to OPEN drops,
  // so recording against a closed/previous drop yields no discount. The sale
  // price is baked into the per-line prices the baker charges, so the total is
  // simply what's charged; the percent is stored for context + the favor baseline.
  const drop = await getDropById(dropId, { fresh: true });
  const flash = flashSaleStatus(drop, new Date());
  const { totalCents } = computeSaleTotals(items);

  const id = await createInPersonSale({
    dropId,
    customerName,
    customerEmail:
      typeof body.customerEmail === "string" ? body.customerEmail : undefined,
    customerPhone:
      typeof body.customerPhone === "string" ? body.customerPhone : undefined,
    items: items.map(({ productSlug, productName, quantity, priceCents }) => ({
      productSlug,
      productName,
      quantity,
      priceCents,
    })),
    totalCents,
    promoPercentOff: flash.active ? flash.percentOff : undefined,
    discountLabel: flash.active ? `Flash Sale −${flash.percentOff}%` : undefined,
  });

  if (!id) {
    return Response.json(
      { error: "Saving isn't configured (no Sanity write token)." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, id });
}
