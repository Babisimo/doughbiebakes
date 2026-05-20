import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToCartButton } from "@/components/add-to-cart-button";
import { CottageFoodNotice } from "@/components/cottage-food-notice";
import { ProductImage } from "@/components/product-image";
import { availabilityOf, buildAvailability, unavailableLabel } from "@/lib/availability";
import {
  getActiveDrop,
  getMemberSelectionsForDrop,
  getProduct,
  getReservationHoldsForDrop,
} from "@/lib/catalog";
import { formatPrice } from "@/lib/money";
import { site } from "@/lib/site";
import { seedProducts } from "@/lib/seed-products";

// Pre-render the bundled menu; CMS-only slugs are rendered on demand.
export function generateStaticParams() {
  return seedProducts.map((p) => ({ slug: p.slug }));
}
export const dynamicParams = true;
// Render per-request so "loaves left" reflects inventory immediately.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Not found" };
  return {
    title: product.name,
    description: product.tagline ?? product.description ?? site.description,
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, drop] = await Promise.all([getProduct(slug), getActiveDrop()]);
  if (!product) notFound();
  const memberSelections = await getMemberSelectionsForDrop(drop);
  const holds = await getReservationHoldsForDrop(drop?.id);
  const availability = availabilityOf(
    buildAvailability(drop, memberSelections, new Date(), holds),
    slug,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        href="/menu"
        className="text-sm font-bold text-acid-600 underline decoration-2 hover:no-underline"
      >
        ← Back to menu
      </Link>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="nb-card overflow-hidden">
          <ProductImage
            src={product.imageUrl}
            alt={product.name}
            priority
            sizes="(min-width: 768px) 32rem, 100vw"
          />
        </div>

        <div className="space-y-5">
          {product.category ? (
            <span className="badge badge-acid">{product.category}</span>
          ) : null}
          <h1 className="display text-5xl sm:text-6xl">{product.name}</h1>
          {product.tagline ? (
            <p className="text-lg text-ink-700">{product.tagline}</p>
          ) : null}
          <p className="inline-block rounded-full panel-acid px-4 py-1.5 text-2xl font-bold text-ink shadow-[var(--shadow-hard-acid)]">
            {formatPrice(product.priceCents)}
          </p>
          {product.description ? (
            <p className="text-ink-700">{product.description}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <AddToCartButton
              slug={product.slug}
              available={availability.canOrder}
              remaining={availability.remaining}
              unavailableLabel={unavailableLabel(availability.reason)}
              className="text-sm"
            />
            {availability.canOrder && availability.remaining != null ? (
              <span className="badge badge-acid">
                {availability.remaining} left this drop
              </span>
            ) : null}
            <Link
              href="/cart"
              className="text-sm font-bold text-acid-600 underline decoration-2 hover:no-underline"
            >
              View order →
            </Link>
          </div>
          {availability.canOrder ? (
            <p className="text-xs text-ink-500">
              Sold by the loaf, only while it&apos;s in the current{" "}
              <Link className="underline" href="/#current-drop">
                drop
              </Link>
              .
            </p>
          ) : (
            <p className="text-xs text-ink-500">
              {availability.reason === "not-open"
                ? "This drop hasn't opened for orders yet — "
                : availability.reason === "not-in-drop"
                  ? "Not in this week's drop — "
                  : "Sold out for this drop — "}
              <Link className="underline" href="/#current-drop">
                see what&apos;s available now
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      {/* Cottage Food label info */}
      <section className="nb-card mt-10 grid gap-6 p-6 sm:p-8 md:grid-cols-2">
        <div>
          <h2 className="display text-2xl">Ingredients</h2>
          {product.ingredients && product.ingredients.length > 0 ? (
            <p className="mt-2 text-sm text-ink-700">{product.ingredients.join(", ")}.</p>
          ) : (
            <p className="mt-2 text-sm text-ink-500">
              Add the full ingredient list in the Studio.
            </p>
          )}
        </div>
        <div>
          <h2 className="display text-2xl">Allergens</h2>
          {product.allergens && product.allergens.length > 0 ? (
            <p className="mt-2 text-sm text-ink-700">
              Contains {product.allergens.join(", ").toLowerCase()}. Baked in a
              kitchen that also handles wheat, dairy, and other allergens.
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-700">
              Baked in a kitchen that handles wheat, dairy, and other allergens.
            </p>
          )}
        </div>
        <div className="border-t border-ink/15 pt-4 md:col-span-2">
          <CottageFoodNotice />
        </div>
      </section>
    </div>
  );
}
