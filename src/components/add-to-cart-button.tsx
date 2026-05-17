"use client";

import { useState } from "react";

import { useCart } from "@/components/cart-provider";

export function AddToCartButton({
  slug,
  available = true,
  remaining = null,
  unavailableLabel = "Sold out",
  className = "",
  label = "Add to order",
}: {
  slug: string;
  available?: boolean;
  /** Loaves left for this product in the drop — caps how many can be added. */
  remaining?: number | null;
  /** Text shown on the disabled button when `available` is false. */
  unavailableLabel?: string;
  className?: string;
  label?: string;
}) {
  const { add, lines } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  if (!available) {
    return (
      <button type="button" disabled className={`btn-acid text-xs ${className}`}>
        {unavailableLabel}
      </button>
    );
  }

  const cartQty = lines.find((l) => l.slug === slug)?.quantity ?? 0;
  const atMax = remaining != null && cartQty >= remaining;

  if (atMax) {
    return (
      <button type="button" disabled className={`btn-acid text-xs ${className}`}>
        Max in cart
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        add(slug, 1, remaining ?? undefined);
        setJustAdded(true);
        window.setTimeout(() => setJustAdded(false), 1400);
      }}
      className={`btn-acid text-xs ${className}`}
    >
      {justAdded ? "Added ✓" : (
        <>
          {label} <span aria-hidden>＋</span>
        </>
      )}
    </button>
  );
}
