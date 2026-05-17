"use client";

import { useEffect } from "react";

import { useCart } from "@/components/cart-provider";

/**
 * Empties the cart once an order has been placed. Renders nothing.
 *
 * Note: we must wait for the provider to finish hydrating from localStorage
 * (`ready`) before clearing — otherwise this child effect runs *before* the
 * provider's hydration effect, `clear()` is a no-op on the still-empty state,
 * and hydration then restores the old cart. Clearing once `ready` flips true
 * runs after hydration and persists the empty cart.
 */
export function ClearCartOnMount() {
  const { clear, ready } = useCart();
  useEffect(() => {
    if (ready) clear();
  }, [ready, clear]);
  return null;
}
