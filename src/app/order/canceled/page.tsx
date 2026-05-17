import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Checkout canceled",
  robots: { index: false },
};

export default function OrderCanceledPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <div className="nb-card p-8 text-center sm:p-12">
        <div className="text-6xl" aria-hidden>
          🧺
        </div>
        <h1 className="display mt-4 text-5xl sm:text-6xl">Checkout canceled</h1>
        <p className="mt-3 text-ink-700">
          No worries — your order is still in your cart. Pick up where you left
          off whenever you&apos;re ready.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/cart" className="btn-acid text-sm">
            Back to your order ＋
          </Link>
          <Link href="/menu" className="btn-outline text-sm">
            Keep browsing
          </Link>
        </div>
      </div>
    </div>
  );
}
