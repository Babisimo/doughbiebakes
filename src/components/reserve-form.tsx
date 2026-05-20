"use client";

import { useMemo, useRef, useState } from "react";

import { useCart } from "@/components/cart-provider";
import { type Availability } from "@/lib/availability";
import { formatPrice } from "@/lib/money";
import { discountCents, discountedTotalCents } from "@/lib/promo-math";
import type { Product } from "@/lib/types";

export function ReserveForm({
  products,
  availability,
}: {
  products: Product[];
  availability: Record<string, Availability>;
}) {
  const { lines, ready, promoCode, promoPercentOff, promoChecking, setPromoCode } =
    useCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mountedAt] = useState<number>(() => Date.now());
  const company = useRef("");

  const catalog = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);
  const rows = lines
    .map((l) => {
      const product = catalog.get(l.slug);
      const a = availability[l.slug];
      if (!product || !a?.canOrder) return null;
      const qty = a.remaining != null ? Math.min(l.quantity, a.remaining) : l.quantity;
      return { product, quantity: qty };
    })
    .filter((r): r is { product: Product; quantity: number } => r !== null);
  const total = rows.reduce((s, r) => s + r.product.priceCents * r.quantity, 0);

  async function submit() {
    setError(null);
    if (rows.length === 0) {
      setError("Nothing in your order is in this week's drop.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          company: company.current,
          code: promoCode.trim(),
          // eslint-disable-next-line react-hooks/purity
          elapsedMs: Date.now() - mountedAt,
          items: rows.map((r) => ({ slug: r.product.slug, quantity: r.quantity })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; notice?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not submit your reservation.");
        setSubmitting(false);
        return;
      }
      setNotice(data.notice ?? null);
      setSent(true);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (sent)
    return (
      <div className="nb-card p-8 text-center">
        <p className="display text-3xl">Check your email 📧</p>
        <p className="mt-2 text-ink-700">
          We sent a confirmation link to <strong>{form.email}</strong>. Click it
          to put your reservation in — we&apos;ll email again once it&apos;s
          approved. (No charge until pickup.)
        </p>
        {notice ? (
          <p className="mt-3 rounded-2xl panel-mono px-3 py-2 text-sm text-center">{notice}</p>
        ) : null}
      </div>
    );
  if (!ready) return <p className="text-ink-500">Loading your order…</p>;
  if (rows.length === 0)
    return (
      <div className="nb-card p-8 text-center">
        <p className="display text-2xl">Nothing to reserve</p>
        <p className="mt-2 text-ink-700">Add loaves from this week&apos;s drop first.</p>
      </div>
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="nb-card space-y-4 p-6">
        <h2 className="display text-xl">Your details</h2>
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          onChange={(e) => {
            company.current = e.target.value;
          }}
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />
        {(["name", "email", "phone"] as const).map((f) => (
          <label key={f} className="block">
            <span className="text-xs font-semibold uppercase text-ink-500">{f}</span>
            <input
              type={f === "email" ? "email" : f === "phone" ? "tel" : "text"}
              value={form[f]}
              onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
              className="mt-1 w-full rounded-2xl border border-ink/20 bg-paper px-3 py-2"
              required
            />
          </label>
        ))}
        <label className="block">
          <span className="text-xs font-semibold uppercase text-ink-500">
            Promo code (optional)
          </span>
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-ink/20 bg-paper px-3 py-2 uppercase"
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
        {error ? <p className="rounded-2xl panel-mono px-3 py-2 text-sm">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !form.name || !form.email || !form.phone}
          className="btn-acid w-full text-sm"
        >
          {submitting ? "Submitting…" : "Request reservation (pay at pickup)"}
        </button>
        <p className="text-center text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
          We&apos;ll email you once it&apos;s confirmed · pay cash/card at pickup
        </p>
      </div>
      <aside className="nb-card h-fit space-y-3 p-6">
        <h2 className="display text-xl">Reserving</h2>
        {rows.map((r) => (
          <div key={r.product.slug} className="flex justify-between text-sm">
            <span>{r.quantity}× {r.product.name}</span>
            <span>{formatPrice(r.product.priceCents * r.quantity)}</span>
          </div>
        ))}
        {promoPercentOff > 0 ? (
          <>
            <div className="flex justify-between border-t border-ink/15 pt-2 text-sm">
              <span>Subtotal</span>
              <span>{formatPrice(total)}</span>
            </div>
            <div className="flex justify-between text-sm text-acid-600">
              <span>Founding discount ({promoPercentOff}% off)</span>
              <span>−{formatPrice(discountCents(total, promoPercentOff))}</span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span>Due at pickup</span>
              <span>
                {formatPrice(discountedTotalCents(total, promoPercentOff))}
              </span>
            </div>
          </>
        ) : (
          <div className="flex justify-between border-t border-ink/15 pt-2 text-sm font-bold">
            <span>Due at pickup</span>
            <span>{formatPrice(total)}</span>
          </div>
        )}
      </aside>
    </div>
  );
}
