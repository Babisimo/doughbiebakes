import { formatPrice } from "@/lib/money";
import { discountedTotalCents } from "@/lib/promo-math";

/**
 * A price that shows a struck-through original next to the discounted price
 * when a flash sale is active. With `percentOff <= 0` it renders exactly the
 * normal price (zero visual change off-sale).
 *
 * `prominent` (default false): when true, renders the product detail page's
 * original large `panel-acid text-2xl` pill treatment instead of the small
 * card pill. Use only on the product detail page.
 */
export function SalePrice({
  cents,
  percentOff,
  prominent = false,
  className = "",
}: {
  cents: number;
  percentOff: number;
  prominent?: boolean;
  className?: string;
}) {
  if (prominent) {
    if (!percentOff || percentOff <= 0) {
      // Restore original product-page prominent price exactly.
      return (
        <p className={`inline-block rounded-full panel-acid px-4 py-1.5 text-2xl font-bold text-ink shadow-[var(--shadow-hard-acid)] ${className}`}>
          {formatPrice(cents)}
        </p>
      );
    }
    const sale = discountedTotalCents(cents, percentOff);
    return (
      <span className={`flex items-center gap-3 ${className}`}>
        <span className="text-lg font-semibold text-ink-500 line-through">{formatPrice(cents)}</span>
        <span className="inline-block rounded-full panel-acid px-4 py-1.5 text-2xl font-bold text-ink shadow-[var(--shadow-hard-acid)]">
          {formatPrice(sale)}
        </span>
      </span>
    );
  }

  if (!percentOff || percentOff <= 0) {
    return (
      <span className={`rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink ${className}`}>
        {formatPrice(cents)}
      </span>
    );
  }
  const sale = discountedTotalCents(cents, percentOff);
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-sm font-semibold text-ink-500 line-through">{formatPrice(cents)}</span>
      <span className="rounded-full bg-ochre px-2.5 py-1 text-sm font-bold text-ink">
        {formatPrice(sale)}
      </span>
    </span>
  );
}
