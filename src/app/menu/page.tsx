import type { Metadata } from "next";
import Link from "next/link";

import { ProductCard } from "@/components/product-card";
import { availabilityOf, buildAvailability } from "@/lib/availability";
import {
  getActiveDrop,
  getMemberSelectionsForDrop,
  getProducts,
  getReservationHoldsForDrop,
} from "@/lib/catalog";
import type { Product } from "@/lib/types";

// Render per-request so "loaves left" reflects inventory immediately.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Menu",
  description: "Every sourdough loaf we bake, with ingredients and allergens.",
};

export default async function MenuPage() {
  const [products, drop] = await Promise.all([getProducts(), getActiveDrop()]);
  const memberSelections = await getMemberSelectionsForDrop(drop);
  const holds = await getReservationHoldsForDrop(drop?.id);
  const availability = buildAvailability(drop, memberSelections, new Date(), holds);

  // Group by category, keeping a stable order.
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.category ?? "Loaves";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(product);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="max-w-prose space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
          The menu
        </p>
        <h1 className="display text-5xl sm:text-6xl">
          Every <span className="text-grad-berry">loaf</span> we bake
        </h1>
        <p className="text-ink-700">
          All naturally leavened, all baked to order. Ordering happens in
          weekly{" "}
          <Link
            className="font-bold text-acid-600 underline decoration-2 hover:no-underline"
            href="/#current-drop"
          >
            drops
          </Link>
          , so &quot;Add to order&quot; is only live for loaves in this week&apos;s
          drop — the rest are on the menu so you know what comes around. Full
          ingredient lists and allergens are on each loaf&apos;s page.
        </p>
      </header>

      {[...groups.entries()].map(([category, items]) => (
        <section key={category} className="mt-12">
          <h2 className="display mb-5 inline-block rounded-full bg-ochre px-4 py-1.5 text-xl text-ink shadow-[var(--shadow-hard-acid)]">
            {category}
          </h2>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((product, i) => (
              <li key={product.slug}>
                <ProductCard
                  product={product}
                  availability={availabilityOf(availability, product.slug)}
                  priority={i < 3}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {products.length === 0 ? (
        <p className="nb-card mt-10 p-8 text-ink-700">
          No products yet — add some in the{" "}
          <Link className="font-bold underline" href="/studio">
            Studio
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
