import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getAdminSession } from "@/lib/admin-auth";
import { getActiveDrop, getMemberSelectionsForDrop } from "@/lib/catalog";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { getStripe } from "@/lib/stripe";

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

  const selections = await getMemberSelectionsForDrop(drop, { fresh: true });

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
  const tallyBySlug = new Map<string, number>();
  for (const s of selections) {
    tallyBySlug.set(s.productSlug, (tallyBySlug.get(s.productSlug) ?? 0) + 1);
  }
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
        <h2 className="display text-2xl">Members ({selections.length})</h2>

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
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((row) => {
                    const a = row.customer?.address;
                    const fulfillment = row.fulfillment ?? "pickup";
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
                          {productNameBySlug.get(row.productSlug) ?? row.productSlug}
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
        <h2 className="display text-2xl">Tally per flavor</h2>
        <p className="mt-1 text-sm text-ink-500">
          Member picks only. Public orders are separate — check Stripe Dashboard
          → Payments for those, or sum up the difference between each drop line
          item&apos;s current and starting quantity.
        </p>
        <ul className="nb-card mt-4 divide-y divide-ink/10 p-0">
          {drop.lineItems.map((li) => {
            const memberCount = tallyBySlug.get(li.product.slug) ?? 0;
            const publicRemaining = Math.max(
              0,
              Math.floor(li.quantity ?? 0) - memberCount,
            );
            return (
              <li
                key={li.product.slug}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="font-semibold">{li.product.name}</span>
                <span className="text-sm text-ink-700">
                  {memberCount} member · {publicRemaining} public stock left
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
