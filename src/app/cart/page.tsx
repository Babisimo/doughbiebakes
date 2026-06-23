import type { Metadata } from "next";

import { CartContents } from "@/components/cart-contents";
import { FlashSaleBanner } from "@/components/flash-sale-banner";
import { buildAvailability } from "@/lib/availability";
import {
  getActiveDrop,
  getMemberSelectionsForDrop,
  getProducts,
  getReservationHoldsForDrop,
} from "@/lib/catalog";
import { flashSaleStatus } from "@/lib/flash-sale";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false },
};

export default async function CartPage() {
  const [products, drop] = await Promise.all([getProducts(), getActiveDrop()]);
  const memberSelections = await getMemberSelectionsForDrop(drop);
  const holds = await getReservationHoldsForDrop(drop?.id);
  // Hand the client component a plain object — Maps don't survive serialization.
  const availability = Object.fromEntries(
    buildAvailability(drop, memberSelections, new Date(), holds),
  );

  const flash = flashSaleStatus(drop, new Date());

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      {flash.active ? (
        <div className="mb-8">
          <FlashSaleBanner state={flash} />
        </div>
      ) : null}
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
        Checkout
      </p>
      <h1 className="display mb-8 mt-1 text-5xl sm:text-6xl">Your order</h1>
      <CartContents
        products={products}
        availability={availability}
        salePercentOff={flash.active ? flash.percentOff : 0}
      />
    </div>
  );
}
