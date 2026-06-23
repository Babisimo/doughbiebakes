import { formatPrice } from "@/lib/money";
import { discountedTotalCents } from "@/lib/promo-math";

/**
 * A price that shows a struck-through original next to the discounted price
 * when a flash sale is active. With `percentOff <= 0` it renders exactly the
 * normal price (zero visual change off-sale).
 */
export function SalePrice({
  cents,
  percentOff,
  className = "",
}: {
  cents: number;
  percentOff: number;
  className?: string;
}) {
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
