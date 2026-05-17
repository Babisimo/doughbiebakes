"use client";

import Link from "next/link";

import { useCart } from "@/components/cart-provider";

export function HeaderCartLink() {
  const { count, ready } = useCart();
  return (
    <Link href="/cart" className="btn-acid px-4 py-1.5 text-sm">
      <span aria-hidden>🧺</span>
      <span>Order</span>
      {ready && count > 0 ? (
        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-xs font-bold text-paper">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
