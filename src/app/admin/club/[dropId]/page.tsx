import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { buildBakeListView } from "@/lib/bake-list";
import { getAdminSession } from "@/lib/admin-auth";
import {
  getActiveDrop,
  getActiveMembers,
  getConfirmedReservationsForDrop,
  getLiveOrdersForDrop,
  getMemberSelectionsForDrop,
  getPendingReservationCountForDrop,
} from "@/lib/catalog";
import {
  deriveDelay,
  STAGE_LABELS,
  summarize,
  type DelayState,
  type FulfillmentStage,
} from "@/lib/fulfillment";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";
import { ClubChargeButton } from "@/components/club-charge-button";
import { ClubMemberRemove } from "@/components/club-member-row-actions";
import { FulfillmentControl } from "@/components/fulfillment-control";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bake list",
  robots: { index: false, follow: false },
};

type StripeCustomerSummary = {
  name: string | null;
  phone: string | null;
  address: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
  } | null;
};

function formatDate(value?: string) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function itemsLabel(items: { name: string; qty: number }[]) {
  return items.map((i) => `${i.qty}× ${i.name}`).join(", ");
}

function stageBadgeClass(s: FulfillmentStage): string {
  const map: Record<FulfillmentStage, string> = {
    new: "badge",
    baking: "badge badge-acid",
    ready: "badge badge-sage",
    sent: "badge",
  };
  return map[s];
}

function DelayChip({ d }: { d: DelayState }) {
  if (d === "behind")
    return (
      <span className="ml-2 text-xs font-bold text-flame-700">⚠ BEHIND</span>
    );
  if (d === "due-soon")
    return (
      <span className="ml-2 text-xs font-semibold text-acid-600">
        ⚠ due soon
      </span>
    );
  if (d === "done")
    return <span className="ml-2 text-xs text-ink-500">✓ done</span>;
  return null;
}

export default async function BakeListPage({
  params,
}: {
  params: Promise<{ dropId: string }>;
}) {
  const { dropId } = await params;

  if (!(await getAdminSession())) {
    redirect(`/admin/login?next=/admin/club/${encodeURIComponent(dropId)}`);
  }

  const drop = await getActiveDrop({ fresh: true });
  if (!drop || drop.id !== dropId) notFound();

  const [selections, orders, reservations, pendingReservationCount, activeMembers] =
    await Promise.all([
      getMemberSelectionsForDrop(drop, { fresh: true }),
      getLiveOrdersForDrop(drop.id, { fresh: true }),
      getConfirmedReservationsForDrop(drop.id, { fresh: true }),
      getPendingReservationCountForDrop(drop.id, { fresh: true }),
      getActiveMembers({ fresh: true }),
    ]);

  // Email → Stripe customer id, so each member row can offer "Remove from club".
  const customerIdByEmail = new Map(
    activeMembers.map((m) => [m.customerEmail.toLowerCase(), m.stripeCustomerId]),
  );

  const view = buildBakeListView({
    drop,
    members: selections,
    orders,
    reservations,
    pendingReservationCount,
  });

  const now = new Date();
  const fSummary = summarize(
    [...view.orders, ...view.reservations],
    drop.pickupOrShipDate,
    now,
  );
  const trackedCount = view.orders.length + view.reservations.length;

  const stripe = getStripe();
  const enriched = await Promise.all(
    selections.map(async (sel) => {
      let customer: StripeCustomerSummary | null = null;
      if (stripe) {
        try {
          const list = await stripe.customers.list({
            email: sel.customerEmail,
            limit: 1,
          });
          const c = list.data[0];
          if (c) {
            customer = {
              name: c.name ?? null,
              phone: c.phone ?? null,
              address: c.shipping?.address ?? null,
            };
          }
        } catch (err) {
          console.error("[admin/club] Stripe lookup failed:", err);
        }
      }
      return { ...sel, customer };
    }),
  );

  const productNameBySlug = new Map(
    drop.lineItems.map((li) => [li.product.slug, li.product.name]),
  );
  const pickupCount = selections.filter(
    (s) => (s.fulfillment ?? "pickup") === "pickup",
  ).length;
  const shipCount = selections.length - pickupCount;

  const pickupLabel = formatDate(drop.pickupOrShipDate);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
            Admin · Bake list
          </p>
          <h1 className="display mt-1 text-4xl sm:text-5xl">{drop.title}</h1>
          <p className="mt-2 text-ink-700">
            Status: <strong>{drop.status}</strong>
            {pickupLabel ? ` · Pickup / ship: ${pickupLabel}` : ""}
          </p>
        </div>
        <form method="POST" action="/api/admin/logout">
          <button
            type="submit"
            className="text-xs font-bold text-acid-600 underline decoration-2 hover:no-underline"
          >
            Log out
          </button>
        </form>
      </div>

      <section className="mt-8">
        <h2 className="display text-2xl">
          Bake totals — {view.counts.loaves} loaf
          {view.counts.loaves === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Everything for this drop: {view.counts.members} member
          {view.counts.members === 1 ? "" : "s"} · {view.counts.orders} public
          order{view.counts.orders === 1 ? "" : "s"} ·{" "}
          {view.counts.reservations} confirmed reservation
          {view.counts.reservations === 1 ? "" : "s"}.
        </p>
        {trackedCount > 0 ? (
          <p className="mt-2 text-sm text-ink-700">
            Fulfillment: {fSummary.byStage.new} new · {fSummary.byStage.baking}{" "}
            baking · {fSummary.byStage.ready} ready · {fSummary.byStage.sent}{" "}
            sent
            {fSummary.behind > 0 || fSummary.dueSoon > 0 ? (
              <>
                {" — "}
                {fSummary.behind > 0 ? (
                  <strong className="text-flame-700">
                    ⚠ {fSummary.behind} behind
                  </strong>
                ) : null}
                {fSummary.behind > 0 && fSummary.dueSoon > 0 ? ", " : ""}
                {fSummary.dueSoon > 0 ? (
                  <strong className="text-acid-600">
                    {fSummary.dueSoon} due soon
                  </strong>
                ) : null}
              </>
            ) : null}
          </p>
        ) : null}
        {view.totals.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            Nobody&apos;s picked yet. Member picks, public orders, and confirmed
            reservations for this drop will tally up here.
          </p>
        ) : (
          <ul className="nb-card mt-4 divide-y divide-ink/10 p-0">
            {view.totals.map((t) => (
              <li
                key={t.slug}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="font-semibold">
                  {t.name}
                  {!t.inDrop ? (
                    <span className="ml-2 align-middle text-xs font-normal text-flame-700">
                      (not in this drop)
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-bold text-ink">bake {t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl">Members ({view.counts.members})</h2>
        <div className="mt-3">
          <ClubChargeButton dropId={drop.id} />
        </div>

        {selections.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            Nobody&apos;s picked yet. Once members open their magic links and
            choose a flavor, they&apos;ll appear here.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-700">
              <strong>{pickupCount}</strong> local pickup ·{" "}
              <strong>{shipCount}</strong> shipping
              {shipCount > 0
                ? ` · ${formatPrice(shipCount * site.breadClub.shipSurchargeCents)} shipping auto-billed on next invoices`
                : ""}
            </p>
            <div className="nb-card mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Flavor</th>
                    <th className="px-4 py-3">Get it via</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Where</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((row) => {
                    const a = row.customer?.address;
                    const fulfillment = row.fulfillment ?? "pickup";
                    const customerId = customerIdByEmail.get(
                      row.customerEmail.toLowerCase(),
                    );
                    return (
                      <tr
                        key={row.customerEmail}
                        className="border-b border-ink/10 align-top last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold">
                            {row.customer?.name ?? "(no name on Stripe)"}
                          </div>
                          <div className="text-ink-700">{row.customerEmail}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {productNameBySlug.get(row.productSlug) ??
                            row.productSlug}
                          {row.source === "default" ? (
                            <span className="ml-2 align-middle text-xs font-normal text-ink-500">
                              (default — never picked)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {fulfillment === "pickup" ? (
                            <span className="badge badge-sage">📍 Pickup</span>
                          ) : (
                            <span className="badge badge-flame">📦 Ship</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {row.customer?.phone ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {fulfillment === "pickup" ? (
                            <span className="text-ink-500">
                              Local pickup — no address needed
                            </span>
                          ) : a ? (
                            <address className="not-italic">
                              {a.line1}
                              {a.line2 ? (
                                <>
                                  <br />
                                  {a.line2}
                                </>
                              ) : null}
                              <br />
                              {[a.city, a.state, a.postal_code]
                                .filter(Boolean)
                                .join(", ")}
                            </address>
                          ) : (
                            <span className="text-flame-700">
                              ⚠ Wants shipping but no address on Stripe
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {customerId ? (
                            <ClubMemberRemove
                              customerId={customerId}
                              email={row.customerEmail}
                            />
                          ) : (
                            <span className="text-ink-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl">
          Public orders ({view.counts.orders})
        </h2>
        {view.orders.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            No paid public orders for this drop yet.
          </p>
        ) : (
          <div className="nb-card mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Get it via</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Where</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.orders.map((o, i) => {
                  const d = deriveDelay(
                    o.fulfillmentStatus,
                    drop.pickupOrShipDate,
                    now,
                  );
                  return (
                    <tr
                      key={o.id || `${o.email}-${i}`}
                      className="border-b border-ink/10 align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {o.name ?? "(no name)"}
                        </div>
                        <div className="text-ink-700">
                          {o.email || "(no email)"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {itemsLabel(o.items)}
                        </div>
                        <div className="text-ink-500">
                          {formatPrice(o.totalCents)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {o.fulfillment === "pickup" ? (
                          <span className="badge badge-sage">📍 Pickup</span>
                        ) : (
                          <span className="badge badge-flame">📦 Ship</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {o.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {o.fulfillment === "pickup" ? (
                          <span className="text-ink-500">
                            Local pickup — no address needed
                          </span>
                        ) : o.shipAddress ? (
                          <address className="not-italic">
                            {o.shipAddress.line1}
                            {o.shipAddress.line2 ? (
                              <>
                                <br />
                                {o.shipAddress.line2}
                              </>
                            ) : null}
                            <br />
                            {[
                              o.shipAddress.city,
                              o.shipAddress.state,
                              o.shipAddress.postalCode,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </address>
                        ) : (
                          <span className="text-flame-700">
                            ⚠ Wants shipping but no address on order
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span>
                            <span className={stageBadgeClass(o.fulfillmentStatus)}>
                              {STAGE_LABELS[o.fulfillmentStatus]}
                            </span>
                            <DelayChip d={d} />
                          </span>
                          {o.id ? (
                            <FulfillmentControl
                              type="order"
                              id={o.id}
                              from={o.fulfillmentStatus}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="display text-2xl">
          Confirmed reservations ({view.counts.reservations})
        </h2>
        {view.pendingReservationCount > 0 ? (
          <p className="mt-2 text-sm text-flame-700">
            {view.pendingReservationCount} pending reservation
            {view.pendingReservationCount === 1 ? "" : "s"} not counted yet —
            review at{" "}
            <a
              className="underline decoration-2 hover:no-underline"
              href="/admin/reservations"
            >
              /admin/reservations
            </a>
            .
          </p>
        ) : null}
        {view.reservations.length === 0 ? (
          <p className="nb-card mt-4 p-6 text-ink-700">
            No confirmed reservations for this drop yet.
          </p>
        ) : (
          <div className="nb-card mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Reserved</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Due at pickup</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.reservations.map((r, i) => {
                  const d = deriveDelay(
                    r.fulfillmentStatus,
                    drop.pickupOrShipDate,
                    now,
                  );
                  return (
                    <tr
                      key={r.id || `${r.email}-${i}`}
                      className="border-b border-ink/10 align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {r.name || "(no name)"}
                        </div>
                        <div className="text-ink-700">
                          {r.email || "(no email)"}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {itemsLabel(r.items)}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {r.phone || "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {formatPrice(r.totalCents)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span>
                            <span className={stageBadgeClass(r.fulfillmentStatus)}>
                              {STAGE_LABELS[r.fulfillmentStatus]}
                            </span>
                            <DelayChip d={d} />
                          </span>
                          {r.id ? (
                            <FulfillmentControl
                              type="reservation"
                              id={r.id}
                              from={r.fulfillmentStatus}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
