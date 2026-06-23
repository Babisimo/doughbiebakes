"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useCart } from "@/components/cart-provider";
import { ProductImage } from "@/components/product-image";
import { type Availability, unavailableLabel } from "@/lib/availability";
import { resolveDiscount } from "@/lib/flash-sale";
import { IS_PRELAUNCH } from "@/lib/launch-mode";
import { formatPrice } from "@/lib/money";
import { discountCents, discountedTotalCents } from "@/lib/promo-math";
import type { Product } from "@/lib/types";

const NOT_IN_DROP: Availability = {
  canOrder: false,
  remaining: null,
  reason: "not-in-drop",
};

const UNAVAILABLE_NOTE: Record<NonNullable<Availability["reason"]>, string> = {
  soldout: "Sold out in this week's drop.",
  "not-in-drop": "Not part of this week's drop.",
  "not-open": "This drop isn't open for orders yet.",
};

export function CartContents({
  products,
  availability,
  salePercentOff = 0,
}: {
  products: Product[];
  /** `slug -> Availability` for everything in the open drop. */
  availability: Record<string, Availability>;
  /** Active flash-sale percent (0 when no sale). Passed from the server component. */
  salePercentOff?: number;
}) {
  const {
    lines,
    setQuantity,
    remove,
    ready,
    promoCode,
    promoPercentOff,
    promoChecking,
    setPromoCode,
  } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Larger of the active flash sale and the typed promo code wins — consistent
  // with the backend (resolveDiscount). When both are 0, effectivePercent is 0
  // and the cart renders exactly as before (no discount line).
  const resolved = resolveDiscount({
    flashPercent: salePercentOff,
    promoPercent: promoPercentOff ?? 0,
  });
  const effectivePercent = resolved.percentOff;

  const catalog = useMemo(
    () => new Map(products.map((p) => [p.slug, p])),
    [products],
  );

  const rows = lines
    .map((line) => {
      const product = catalog.get(line.slug);
      if (!product) return null;
      const avail = availability[line.slug] ?? NOT_IN_DROP;
      const maxQty = avail.canOrder ? Math.max(1, avail.remaining ?? 12) : 0;
      const overLimit =
        avail.canOrder && avail.remaining != null && line.quantity > avail.remaining;
      return { product, quantity: line.quantity, avail, maxQty, overLimit };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Trim any line that exceeds what's left in the drop (e.g. a stale cart from
  // before stock changed, or an old 12-loaf entry). Converges in one pass; safe
  // no-op when nothing is over.
  useEffect(() => {
    if (!ready) return;
    for (const line of lines) {
      const avail = availability[line.slug];
      if (!avail || !avail.canOrder) continue;
      const max = Math.max(1, avail.remaining ?? 12);
      if (line.quantity > max) setQuantity(line.slug, max);
    }
  }, [ready, lines, availability, setQuantity]);

  const blockedCount = rows.filter((r) => !r.avail.canOrder).length;
  const canCheckout = rows.length > 0 && blockedCount === 0;

  const subtotal = rows.reduce(
    (sum, r) =>
      sum + (r.avail.canOrder ? r.product.priceCents * Math.min(r.quantity, r.maxQty) : 0),
    0,
  );

  async function checkout() {
    setError(null);
    if (!canCheckout) {
      setError("Remove the loaves below that aren't in this week's drop, then check out.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: promoCode.trim(),
          items: rows
            .filter((r) => r.avail.canOrder)
            .map((r) => ({ slug: r.product.slug, quantity: Math.min(r.quantity, r.maxQty) })),
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start checkout.");
        setSubmitting(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <p className="text-ink-500">Loading your order…</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="nb-card p-10 text-center">
        <p className="display text-3xl">Your order is empty</p>
        <p className="mt-2 text-ink-700">Go grab a loaf before the drop sells out.</p>
        <Link href="/menu" className="btn-acid mt-6 inline-flex text-sm">
          Browse the menu <span aria-hidden>＋</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_21rem]">
      <ul className="nb-card divide-y divide-white/50 overflow-hidden">
        {rows.map(({ product, quantity, avail, maxQty, overLimit }) => (
          <li
            key={product.slug}
            className={`flex gap-4 p-4 ${avail.canOrder ? "" : "opacity-75"}`}
          >
            <div className="w-24 shrink-0 overflow-hidden rounded-2xl">
              <ProductImage src={product.imageUrl} alt={product.name} sizes="96px" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex justify-between gap-3">
                <Link
                  href={`/product/${product.slug}`}
                  className="display text-lg hover:text-acid-600"
                >
                  {product.name}
                </Link>
                <span className="text-sm font-bold">{formatPrice(product.priceCents)}</span>
              </div>

              {avail.canOrder ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label
                      className="text-xs font-semibold uppercase text-ink-500"
                      htmlFor={`qty-${product.slug}`}
                    >
                      Qty
                    </label>
                    <select
                      id={`qty-${product.slug}`}
                      value={Math.min(quantity, maxQty)}
                      onChange={(e) => setQuantity(product.slug, Number(e.target.value))}
                      className="rounded-full border border-ink/20 bg-paper px-3 py-1 text-sm"
                    >
                      {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-ink-500">{maxQty} left in this drop</span>
                    <button
                      type="button"
                      onClick={() => remove(product.slug)}
                      className="text-xs font-semibold uppercase text-acid-600 underline decoration-2 hover:no-underline"
                    >
                      Remove
                    </button>
                    <span className="ml-auto text-sm text-ink-500">
                      {formatPrice(product.priceCents * Math.min(quantity, maxQty))}
                    </span>
                  </div>
                  {overLimit ? (
                    <p className="mt-1 text-xs font-semibold text-acid-600">
                      Only {avail.remaining} left — we trimmed your order to match.
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="badge badge-flame">{unavailableLabel(avail.reason)}</span>
                  <span className="text-xs text-ink-700">
                    {avail.reason ? UNAVAILABLE_NOTE[avail.reason] : "Unavailable."}
                  </span>
                  <Link
                    href="/#current-drop"
                    className="text-xs font-semibold uppercase text-acid-600 underline decoration-2 hover:no-underline"
                  >
                    See current drop →
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(product.slug)}
                    className="ml-auto text-xs font-semibold uppercase text-acid-600 underline decoration-2 hover:no-underline"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <aside className="nb-card h-fit space-y-4 p-6">
        <h2 className="display text-xl">Summary</h2>
        <div className="flex justify-between border-y border-ink/15 py-2 text-sm">
          <span className="font-semibold uppercase">Subtotal</span>
          <span className="font-bold">{formatPrice(subtotal)}</span>
        </div>
        {effectivePercent > 0 ? (
          <div className="space-y-1">
            <div className="flex justify-between text-sm text-acid-600">
              <span className="font-semibold">
                {resolved.source === "flash"
                  ? `Flash sale (${effectivePercent}% off)`
                  : `Founding discount (${effectivePercent}% off)`}
              </span>
              <span className="font-bold">
                −{formatPrice(discountCents(subtotal, effectivePercent))}
              </span>
            </div>
            <div className="flex justify-between border-b border-ink/15 pb-2 text-sm">
              <span className="font-semibold uppercase">Discounted total</span>
              <span className="font-bold">
                {formatPrice(discountedTotalCents(subtotal, effectivePercent))}
              </span>
            </div>
          </div>
        ) : null}
        <p className="text-xs text-ink-700">
          Shipping (local pickup in Corona — free, or USPS Priority within
          California) is picked at checkout. Taxes, if any, are computed by Stripe.
        </p>
        {blockedCount > 0 ? (
          <p className="rounded-2xl panel-mono px-3 py-2 text-sm">
            Remove the {blockedCount === 1 ? "loaf" : `${blockedCount} loaves`} that
            aren&apos;t in this week&apos;s drop to check out.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-2xl panel-mono px-3 py-2 text-sm">{error}</p>
        ) : null}
        <label className="block">
          <span className="text-xs font-semibold uppercase text-ink-500">
            Promo code (optional)
          </span>
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-ink/20 bg-paper px-3 py-2 text-sm uppercase"
            autoComplete="off"
          />
          {promoCode.trim() && !promoChecking ? (
            promoPercentOff > 0 ? (
              <span className="mt-1 block text-xs font-semibold text-acid-600">
                ✓ {promoPercentOff}% off applied
              </span>
            ) : (
              <span className="mt-1 block text-xs text-ink-500">
                That code isn&apos;t valid.
              </span>
            )
          ) : null}
        </label>
        {canCheckout ? (
          <Link
            href="/reserve"
            className="btn-acid w-full justify-center text-sm"
          >
            Reserve &amp; pay at pickup
          </Link>
        ) : null}
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          {IS_PRELAUNCH
            ? "Local pickup only · pay at pickup"
            : "Local pickup · pay cash or card when you pick up"}
        </p>
        {/*
          Stripe "pay online" path is hidden while in pre-launch / friends-only
          mode — we can't legally take payment until the CFO permit is issued.
          The Reserve button above remains as the only checkout action.
        */}
        {IS_PRELAUNCH ? null : (
          <>
            <button
              type="button"
              onClick={checkout}
              disabled={submitting || !canCheckout}
              className="btn-outline w-full text-sm"
            >
              {submitting ? "Redirecting…" : "Pre-order & pay online ＋"}
            </button>
            <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
              Pay now with Stripe · needed for California shipping
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
