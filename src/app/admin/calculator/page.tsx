import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";
import { buildBakeListView } from "@/lib/bake-list";
import {
  getConfirmedReservationsForDrop,
  getDropFinancials,
  getDropsView,
  getLiveOrdersForDrop,
  getMemberChargesForDrop,
  getMemberSelectionsForDrop,
  getPendingReservationCountForDrop,
} from "@/lib/catalog";
import {
  actualFavorsCents,
  favorLines,
  reservationCollectedCents,
  type FavorLine,
  type FavorSource,
} from "@/lib/favors";
import { formatPrice } from "@/lib/money";
import { productCostCents } from "@/lib/profitability";
import { ProfitabilityCalculator } from "./calculator-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ROI & profitability",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ drop?: string }> };

export default async function CalculatorPage({ searchParams }: Props) {
  if (!(await getAdminSession())) {
    redirect("/admin/login?next=/admin/calculator");
  }

  const { drop: dropParam } = await searchParams;
  const { current, previous } = await getDropsView({ fresh: true });

  // Selectable drops: the active one plus recently-ended ones.
  const selectable = [current, ...previous].filter(
    (d): d is NonNullable<typeof d> => d !== null,
  );
  const drops = selectable.map((d) => ({ id: d.id, title: d.title }));
  const drop =
    selectable.find((d) => d.id === dropParam) ?? current ?? selectable[0] ?? null;

  if (!drop) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Header />
        <p className="nb-card mt-6 p-6 text-ink-700">
          No drops yet. Publish a drop in{" "}
          <Link className="underline" href="/studio" target="_blank" rel="noreferrer">
            Sanity Studio
          </Link>{" "}
          and its numbers will show up here.
        </p>
      </div>
    );
  }

  // Pull everything sold for this drop, then aggregate to per-loaf counts and
  // real revenue. No new queries — reuse the same reads the bake list uses.
  const [selections, orders, reservations, pendingReservationCount, charges, saved] =
    await Promise.all([
      getMemberSelectionsForDrop(drop, { fresh: true }),
      getLiveOrdersForDrop(drop.id, { fresh: true }),
      getConfirmedReservationsForDrop(drop.id, { fresh: true }),
      getPendingReservationCountForDrop(drop.id, { fresh: true }),
      getMemberChargesForDrop(drop.id, { fresh: true }),
      getDropFinancials(drop.id),
    ]);

  const view = buildBakeListView({
    drop,
    members: selections,
    orders,
    reservations,
    pendingReservationCount,
  });
  const soldBySlug = new Map(view.totals.map((t) => [t.slug, t.count]));

  const seedLines = drop.lineItems.map((li) => {
    const sold = soldBySlug.get(li.product.slug) ?? 0;
    return {
      slug: li.product.slug,
      name: li.product.name,
      sold,
      // Planned quantity on the drop — shown as a reference hint.
      planned: li.quantity,
      // Default to what has ACTUALLY sold so far (0 until a sale lands), so the
      // ROI reflects real current sales while the drop is still open.
      units: sold,
      listPriceCents: li.product.priceCents,
      // Hybrid cost: recipe-from-pantry when set, else the flat field.
      defaultCostCents: productCostCents(li.product),
    };
  });

  const listBySlug = new Map(
    drop.lineItems.map((li) => [li.product.slug, li.product.priceCents] as const),
  );
  const favorsActualCents = actualFavorsCents([...orders, ...reservations], listBySlug);

  const actualCollectedCents =
    orders.reduce((s, o) => s + o.totalCents, 0) +
    reservations.reduce((s, r) => s + reservationCollectedCents(r), 0) +
    charges
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + c.amountCents, 0);

  // Itemized "who got a favor, on what loaf" from the same live orders +
  // reservations the favor total is computed from.
  const favorSources: FavorSource[] = [
    ...orders.map((o) => ({ who: o.customerName || "(no name)", items: o.items })),
    ...reservations.map((r) => ({
      who: r.customerName || "(no name)",
      promoPercentOff: r.promoPercentOff,
      items: r.items,
    })),
  ];
  const favors = favorLines(favorSources, listBySlug);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Header />
      <div className="mt-8">
        <ProfitabilityCalculator
          key={drop.id}
          dropId={drop.id}
          dropTitle={drop.title}
          dropDate={
            drop.pickupOrShipDate ?? drop.ordersCloseAt ?? drop.createdAt ?? null
          }
          drops={drops}
          seedLines={seedLines}
          actualCollectedCents={actualCollectedCents}
          actualFavorsCents={favorsActualCents}
          savedFixedCosts={saved?.fixedCosts ?? null}
        />
      </div>
      <FavorBreakdown lines={favors} />
    </div>
  );
}

/** Read-only "who got a favor, on what loaf" list for the selected drop. */
function FavorBreakdown({ lines }: { lines: FavorLine[] }) {
  const total = lines.reduce((s, l) => s + l.favorCents, 0);
  return (
    <section className="mt-10">
      <h2 className="display text-2xl">
        Favors given — who &amp; what
        {lines.length > 0 ? (
          <span className="ml-2 align-middle text-base font-normal text-ink-500">
            · total {formatPrice(total)}
          </span>
        ) : null}
      </h2>
      {lines.length === 0 ? (
        <p className="nb-card mt-3 p-5 text-ink-700">
          No favors given on this drop.
        </p>
      ) : (
        <ul className="nb-card mt-3 divide-y divide-ink/10 p-0">
          {lines.map((l, i) => (
            <li
              key={`${l.who}-${l.productName}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
            >
              <span>
                <span className="font-semibold">{l.who}</span>
                <span className="text-ink-700">
                  {" "}
                  · {l.quantity}× {l.productName}
                </span>
              </span>
              <span className="text-sm text-ink-500">
                charged {formatPrice(l.chargedCents)} of {formatPrice(l.listCents)}{" "}
                ea ·{" "}
                <span className="font-bold text-flame-700">
                  {formatPrice(l.favorCents)} given
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
          Admin · ROI &amp; profitability
        </p>
        <h1 className="display mt-1 text-4xl sm:text-5xl">What did the drop earn?</h1>
        <p className="mt-2 max-w-prose text-ink-700">
          Cost out a drop, account for the favors you hand returning customers,
          and see your margin, ROI, and break-even.
        </p>
      </div>
      <Link
        href="/admin"
        className="text-sm font-bold text-acid-600 underline decoration-2 hover:no-underline"
      >
        ← Admin
      </Link>
    </div>
  );
}
