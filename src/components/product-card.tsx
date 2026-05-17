import Link from "next/link";

import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductImage } from "@/components/product-image";
import { type Availability, unavailableLabel } from "@/lib/availability";
import { formatPrice } from "@/lib/money";
import type { Product } from "@/lib/types";

export function ProductCard({
  product,
  availability,
  priority = false,
}: {
  product: Product;
  /** Buyability of this loaf, derived from the open drop. */
  availability: Availability;
  priority?: boolean;
}) {
  const { canOrder, remaining, reason } = availability;
  const badge = canOrder
    ? remaining != null
      ? `${remaining} left`
      : null
    : unavailableLabel(reason);

  return (
    <article className="nb-card nb-interactive flex flex-col overflow-hidden">
      <div className="relative">
        <Link href={`/product/${product.slug}`} className="block">
          <ProductImage src={product.imageUrl} alt={product.name} priority={priority} />
        </Link>
        {badge ? (
          <span
            className={`badge absolute right-3 top-3 ${
              canOrder ? "badge-acid" : "badge-flame"
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="display text-xl leading-tight">
            <Link href={`/product/${product.slug}`} className="hover:text-acid-600">
              {product.name}
            </Link>
          </h3>
          <span className="shrink-0 rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink">
            {formatPrice(product.priceCents)}
          </span>
        </div>
        {product.tagline ? (
          <p className="text-sm text-ink-700">{product.tagline}</p>
        ) : null}
        {product.allergens && product.allergens.length > 0 ? (
          <p className="mt-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-500">
            Contains: {product.allergens.join(", ")}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
          <AddToCartButton
            slug={product.slug}
            available={canOrder}
            remaining={remaining}
            unavailableLabel={unavailableLabel(reason)}
          />
        </div>
      </div>
    </article>
  );
}
