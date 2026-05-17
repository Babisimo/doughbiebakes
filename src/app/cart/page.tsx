import type { Metadata } from "next";

import { CartContents } from "@/components/cart-contents";
import { buildAvailability } from "@/lib/availability";
import { getActiveDrop, getMemberSelectionsForDrop, getProducts } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false },
};

export default async function CartPage() {
  const [products, drop] = await Promise.all([getProducts(), getActiveDrop()]);
  const memberSelections = await getMemberSelectionsForDrop(drop);
  // Hand the client component a plain object — Maps don't survive serialization.
  const availability = Object.fromEntries(buildAvailability(drop, memberSelections));

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
        Checkout
      </p>
      <h1 className="display mb-8 mt-1 text-5xl sm:text-6xl">Your order</h1>
      <CartContents products={products} availability={availability} />
    </div>
  );
}
