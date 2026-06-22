import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InPersonSaleForm, type SaleDrop } from "@/components/in-person-sale-form";
import { ReservationActions } from "@/components/reservation-actions";
import { getAdminSession } from "@/lib/admin-auth";
import { getDropsView } from "@/lib/catalog";
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
  items: { productName: string; quantity: number }[];
  promoCode?: string;
  promoPercentOff?: number;
  discountedTotalCents?: number;
};

export default async function AdminReservationsPage() {
  if (!(await getAdminSession())) redirect("/admin/login");
  const fresh = sanityClient?.withConfig({ useCdn: false }) ?? null;
  const rows = fresh
    ? await fresh.fetch<Row[]>(RESERVATIONS_QUERY, {}, { cache: "no-store" })
    : [];

  const { current, previous } = await getDropsView({ fresh: true });
  const saleDrops: SaleDrop[] = [current, ...previous]
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({
      id: d.id,
      title: d.title,
      lines: d.lineItems.map((li) => ({
        productSlug: li.product.slug,
        productName: li.product.name,
        listPriceCents: li.product.priceCents,
      })),
    }));

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
                  {r.promoCode && typeof r.discountedTotalCents === "number" ? (
                    <>
                      <span className="font-bold">{formatPrice(r.discountedTotalCents)}</span>{" "}
                      <span className="text-xs text-ink-500 line-through">{formatPrice(r.totalCents)}</span>{" "}
                      <span className="text-xs font-semibold uppercase text-acid-600">
                        {r.promoCode}
                          {typeof r.promoPercentOff === "number" ? ` −${r.promoPercentOff}%` : ""}
                      </span>
                    </>
                  ) : (
                    formatPrice(r.totalCents)
                  )}{" "}
                  · {r.dropTitle ?? "—"}
                </p>
              </div>
              {r.status === "pending" ? <ReservationActions id={r.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
