import Link from "next/link";

import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductImage } from "@/components/product-image";
import { SalePrice } from "@/components/sale-price";
import { type Availability, unavailableLabel } from "@/lib/availability";
import type { Product } from "@/lib/types";

export function ProductCard({
  product,
  availability,
  priority = false,
  salePercentOff = 0,
}: {
  product: Product;
  /** Buyability of this loaf, derived from the open drop. */
  availability: Availability;
  priority?: boolean;
  salePercentOff?: number;
}) {
  const { canOrder, remaining, reason } = availability;
  const badge = canOrder
    ? remaining != null
      ? `${remaining} Loaf${remaining === 1 ? "" : "s"} Left`
      : null
    : unavailableLabel(reason);

  return (
    <article className="nb-card nb-interactive relative flex flex-col">
      <div className="relative overflow-hidden rounded-t-[1.75rem]">
        <Link href={`/product/${product.slug}`} className="block">
          <ProductImage src={product.imageUrl} alt={product.name} priority={priority} />
        </Link>
      </div>
      {badge ? (
        <span
          className={`badge badge-count absolute -right-3 -top-3 z-10 rotate-[-6deg] text-sm uppercase shadow-[var(--shadow-hard-acid)] ${
            canOrder ? "badge-acid" : "badge-flame"
          }`}
        >
          {badge}
        </span>
      ) : null}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="display text-xl leading-tight">
            <Link href={`/product/${product.slug}`} className="hover:text-acid-600">
              {product.name}
            </Link>
          </h3>
          <SalePrice
            cents={product.priceCents}
            percentOff={salePercentOff}
            className="shrink-0"
          />
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
