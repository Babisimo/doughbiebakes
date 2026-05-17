import Link from "next/link";

import { ProductImage } from "@/components/product-image";
import type { Drop } from "@/lib/types";

function endedDate(drop: Drop): string | null {
  const src = drop.ordersCloseAt ?? drop.pickupOrShipDate;
  if (!src) return null;
  const ms = new Date(src).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "Previous drops" — the most recently-ended drops (already filtered/capped
 * by getDropsView). Loaves are shown but unbuyable: the FOMO showcase. Renders
 * nothing when there are no previous drops.
 */
export function PreviousDrops({ drops }: { drops: Drop[] }) {
  if (drops.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="display text-4xl sm:text-5xl">Previous drops</h2>
        <p className="text-sm text-ink-500">
          What you missed — flavors come back around.
        </p>
      </div>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2">
        {drops.map((drop) => {
          const when = endedDate(drop);
          return (
            <li key={drop.id} className="nb-card flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="display text-2xl leading-tight">{drop.title}</h3>
                <span className="badge badge-flame">
                  Ended{when ? ` · ${when}` : ""}
                </span>
              </div>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {drop.lineItems.map(({ product }) => (
                  <li key={product.slug}>
                    <Link
                      href={`/product/${product.slug}`}
                      className="block overflow-hidden rounded-2xl border border-ink/10 opacity-75 grayscale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:opacity-100 hover:grayscale-0"
                      title={product.name}
                    >
                      <ProductImage src={product.imageUrl} alt={product.name} />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-700">
                {drop.lineItems.map((li) => li.product.name).join(" · ")}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
