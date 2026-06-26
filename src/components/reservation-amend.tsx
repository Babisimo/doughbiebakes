"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { effectiveListCents } from "@/lib/favors";
import { formatPrice } from "@/lib/money";

export type AmendDropLine = {
  productSlug: string;
  productName: string;
  listPriceCents: number;
};
type AmendItem = {
  productSlug: string;
  productName: string;
  quantity: number;
  priceCents: number;
};

const dollars = (cents: number) => (cents / 100).toFixed(2);
const toCents = (v: string) => {
  const n = Math.round(Number.parseFloat(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const toQty = (v: string) => {
  const n = Math.floor(Number.parseFloat(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function ReservationAmend({
  reservationId,
  dropLines,
  items,
  totalCents,
  collectedCents,
  canEditQuantity = false,
  promoPercentOff,
  discountLabel,
}: {
  reservationId: string;
  dropLines: AmendDropLine[];
  items: AmendItem[];
  totalCents: number;
  collectedCents?: number;
  /** In-person sales only: lets the baker correct a mis-entered quantity. */
  canEditQuantity?: boolean;
  /** Stored flash-sale percent, re-applied live to the recomputed subtotal. */
  promoPercentOff?: number;
  discountLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Editable per-item charged price (cents), keyed by slug.
  const [prices, setPrices] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((it) => [it.productSlug, it.priceCents])),
  );
  // Editable per-item quantity (in-person only), keyed by slug.
  const [quantities, setQuantities] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((it) => [it.productSlug, it.quantity])),
  );
  const listBySlug = useMemo(
    () => new Map(dropLines.map((l) => [l.productSlug, l.listPriceCents])),
    [dropLines],
  );

  const priceOf = (it: AmendItem) => prices[it.productSlug] ?? it.priceCents;
  const qtyOf = (it: AmendItem) =>
    canEditQuantity ? quantities[it.productSlug] ?? it.quantity : it.quantity;
  // The per-loaf favor baseline: the sale price when a flash sale applied, else
  // list. Charged prices already reflect the sale, so they are the going rate.
  const baselineOf = (slug: string) => {
    const list = listBySlug.get(slug);
    return typeof list === "number" ? effectiveListCents(list, promoPercentOff) : undefined;
  };
  const pct = Math.max(0, Math.floor(promoPercentOff ?? 0));

  // Total due is simply what's charged across the (possibly amended) lines.
  const newTotal = items.reduce((s, it) => s + priceOf(it) * qtyOf(it), 0);

  // Actually-collected input (cents). Seeded from a real override or the total.
  const [collected, setCollected] = useState<number>(collectedCents ?? totalCents);
  // True once the baker explicitly typed a collected amount (or one was loaded).
  // Until then, the field tracks the live recomputed total.
  const [collectedTouched, setCollectedTouched] = useState<boolean>(collectedCents != null);
  const effectiveCollected = collectedTouched ? collected : newTotal;

  const qtyInvalid = canEditQuantity && items.some((it) => qtyOf(it) < 1);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payloadItems = items.map((it) => {
        const price = priceOf(it);
        return {
          productSlug: it.productSlug,
          productName: it.productName,
          quantity: qtyOf(it),
          priceCents: price,
          // List price drives the (server-ignored) favor calc; fall back to the
          // charged price when this loaf isn't in the current drop (favor 0).
          listPriceCents: listBySlug.get(it.productSlug) ?? price,
        };
      });
      // Equal to the recomputed total ⇒ clear the override (null) for clean data.
      const collectedCentsPayload =
        effectiveCollected === newTotal ? null : effectiveCollected;

      const res = await fetch(
        `/api/admin/reservations/${reservationId}/amend`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: payloadItems, collectedCents: collectedCentsPayload }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-outline text-sm">
        {canEditQuantity ? "Edit" : "Edit prices"}
      </button>
    );
  }

  return (
    <div className="nb-card mt-3 w-full space-y-3 p-4">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-ink-500">
          <tr>
            <th className="py-2">Loaf</th>
            <th className="py-2">Qty</th>
            <th className="py-2">List</th>
            <th className="py-2">Price each</th>
            <th className="py-2 text-right">Favor</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const price = priceOf(it);
            const qty = qtyOf(it);
            const baseline = baselineOf(it.productSlug);
            const favor =
              typeof baseline === "number" ? qty * Math.max(0, baseline - price) : 0;
            return (
              <tr key={it.productSlug} className="border-t border-ink/10">
                <td className="py-2 font-semibold">{it.productName}</td>
                <td className="py-2">
                  {canEditQuantity ? (
                    <input
                      type="number"
                      min={1}
                      step="1"
                      aria-label={`Quantity of ${it.productName}`}
                      value={qty || ""}
                      onChange={(e) =>
                        setQuantities((cur) => ({
                          ...cur,
                          [it.productSlug]: toQty(e.target.value),
                        }))
                      }
                      className="w-16 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
                    />
                  ) : (
                    <span className="text-ink-700">{it.quantity}×</span>
                  )}
                </td>
                <td className="py-2 text-ink-500">
                  {typeof baseline === "number" ? formatPrice(baseline) : "—"}
                </td>
                <td className="py-2">
                  <span className="text-ink-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Price each for ${it.productName}`}
                    value={dollars(price)}
                    onChange={(e) =>
                      setPrices((cur) => ({ ...cur, [it.productSlug]: toCents(e.target.value) }))
                    }
                    className="ml-1 w-20 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
                  />
                </td>
                <td className="py-2 text-right">{favor > 0 ? formatPrice(favor) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm font-semibold" htmlFor={`collected-${reservationId}`}>
          Actually collected{" "}
          <span className="text-ink-500">$</span>
          <input
            id={`collected-${reservationId}`}
            type="number"
            min={0}
            step="0.01"
            value={dollars(effectiveCollected)}
            onChange={(e) => {
              setCollected(toCents(e.target.value));
              setCollectedTouched(true);
            }}
            className="ml-1 w-24 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
          />
        </label>
        <p className="text-sm">
          Total due <strong>{formatPrice(newTotal)}</strong>
          {pct > 0 ? (
            <span className="ml-2 text-xs font-semibold uppercase text-acid-600">
              {discountLabel ?? `Flash Sale −${pct}%`}
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {msg ? <span className="text-xs text-flame-700">{msg}</span> : null}
        <button type="button" onClick={() => setOpen(false)} className="btn-outline text-sm">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || qtyInvalid}
          onClick={save}
          className="btn-acid text-sm disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
