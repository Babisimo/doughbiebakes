import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InPersonSaleForm, type SaleDrop } from "@/components/in-person-sale-form";
import { ReservationActions } from "@/components/reservation-actions";
import { ReservationAmend } from "@/components/reservation-amend";
import { getAdminSession } from "@/lib/admin-auth";
import { getDropsView } from "@/lib/catalog";
import { flashSaleStatus } from "@/lib/flash-sale";
import { formatPrice } from "@/lib/money";
import { sanityClient } from "@/sanity/client";
import { RESERVATIONS_QUERY } from "@/sanity/lib/queries";

export const dynamic = "force-dynamic";

// Admin page with customer PII — keep it out of search indexes, matching the
// other /admin/* pages.
export const metadata: Metadata = {
  title: "Pickup reservations",
  robots: { index: false, follow: false },
};

type Row = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dropId?: string;
  dropTitle?: string;
  status: "pending" | "confirmed" | "declined";
  channel?: "online" | "in-person";
  totalCents: number;
  collectedCents?: number;
  createdAt: string;
  items: { productSlug: string; productName: string; quantity: number; priceCents: number }[];
  promoCode?: string;
  promoPercentOff?: number;
  discountedTotalCents?: number;
  discountLabel?: string;
};

export default async function AdminReservationsPage() {
  if (!(await getAdminSession())) redirect("/admin/login");
  const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;
  const rows = fresh
    ? await fresh.fetch<Row[]>(RESERVATIONS_QUERY, {}, { cache: "no-store" })
    : [];

  const now = new Date();
  const { current, previous } = await getDropsView({ fresh: true });
  const saleDrops: SaleDrop[] = [current, ...previous]
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => {
      // A flash sale is gated to OPEN drops, so previous/closed drops resolve to
      // 0 here and the form records them at full price, as it should.
      const flash = flashSaleStatus(d, now);
      return {
        id: d.id,
        title: d.title,
        flashPercentOff: flash.active ? flash.percentOff : 0,
        lines: d.lineItems.map((li) => ({
          productSlug: li.product.slug,
          productName: li.product.name,
          listPriceCents: li.product.priceCents,
        })),
      };
    });
  const linesByDropId = new Map(saleDrops.map((d) => [d.id, d.lines]));

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="display text-4xl">Pickup reservations</h1>
      <div className="mt-4">
        <InPersonSaleForm drops={saleDrops} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-ink-700">No reservations yet.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="nb-card flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="display text-lg">
                  {r.customerName}{" "}
                  <span className={`badge ${r.status === "pending" ? "badge-acid" : r.status === "confirmed" ? "badge-sage" : "badge-flame"}`}>
                    {r.status}
                  </span>
                  {r.channel === "in-person" ? (
                    <span className="badge badge-sage">in-person</span>
                  ) : null}
                </p>
                <p className="text-sm text-ink-700">
                  {r.customerEmail} · {r.customerPhone} ·{" "}
                  {r.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")} ·{" "}
                  {(r.promoCode || r.discountLabel) &&
                  typeof r.discountedTotalCents === "number" ? (
                    // Online discount-on-total: show discounted vs full (struck).
                    <>
                      <span className="font-bold">{formatPrice(r.discountedTotalCents)}</span>{" "}
                      <span className="text-xs text-ink-500 line-through">{formatPrice(r.totalCents)}</span>{" "}
                      <span className="text-xs font-semibold uppercase text-acid-600">
                        {r.promoCode
                          ? `${r.promoCode}${typeof r.promoPercentOff === "number" ? ` −${r.promoPercentOff}%` : ""}`
                          : r.discountLabel}
                      </span>
                    </>
                  ) : (
                    // In-person sale price is baked into the total; show a badge for context.
                    <>
                      <span className="font-bold">{formatPrice(r.totalCents)}</span>
                      {r.discountLabel ? (
                        <span className="ml-1 text-xs font-semibold uppercase text-acid-600">
                          {r.discountLabel}
                        </span>
                      ) : null}
                    </>
                  )}{" "}
                  · {r.dropTitle ?? "—"}
                </p>
              </div>
              {r.status === "pending" ? <ReservationActions id={r.id} /> : null}
              {r.status === "confirmed" ? (
                <ReservationAmend
                  reservationId={r.id}
                  dropLines={linesByDropId.get(r.dropId ?? "") ?? []}
                  items={r.items.map((i) => ({
                    productSlug: i.productSlug,
                    productName: i.productName,
                    quantity: i.quantity,
                    priceCents: i.priceCents,
                  }))}
                  totalCents={r.totalCents}
                  collectedCents={r.collectedCents}
                  canEditQuantity={r.channel === "in-person"}
                  promoPercentOff={r.promoPercentOff}
                  discountLabel={r.discountLabel}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
