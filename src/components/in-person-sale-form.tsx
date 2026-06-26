"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { computeInPersonSale, type SaleLineInput } from "@/lib/favors";
import { formatPrice } from "@/lib/money";

type DropLine = { productSlug: string; productName: string; listPriceCents: number };
export type SaleDrop = {
  id: string;
  title: string;
  /** Active flash-sale percent off for this drop (0 when no sale is live). */
  flashPercentOff: number;
  lines: DropLine[];
};

type Row = { quantity: number; priceCents: number };

const dollars = (cents: number) => (cents / 100).toFixed(2);
const toCents = (v: string) => {
  const n = Math.round(Number.parseFloat(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const toQty = (v: string) => {
  const n = Math.floor(Number.parseFloat(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function InPersonSaleForm({ drops }: { drops: SaleDrop[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dropId, setDropId] = useState(drops[0]?.id ?? "");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const drop = drops.find((d) => d.id === dropId) ?? null;

  const saleItems = useMemo<SaleLineInput[]>(() => {
    if (!drop) return [];
    return drop.lines
      .map((l) => {
        const row = rows[l.productSlug];
        const quantity = row?.quantity ?? 0;
        const priceCents = row?.priceCents ?? l.listPriceCents;
        return {
          productSlug: l.productSlug,
          productName: l.productName,
          quantity,
          priceCents,
          listPriceCents: l.listPriceCents,
        };
      })
      .filter((i) => i.quantity > 0);
  }, [drop, rows]);

  const flashPercentOff = drop?.flashPercentOff ?? 0;
  const { totalCents, favorsCents, discountedTotalCents, promoPercentOff } =
    computeInPersonSale(saleItems, flashPercentOff);
  const saleActive = typeof discountedTotalCents === "number";
  const collectedCents = discountedTotalCents ?? totalCents;

  function setRow(slug: string, patch: Partial<Row>) {
    setRows((cur) => {
      const prev = cur[slug] ?? { quantity: 0, priceCents: 0 };
      return { ...cur, [slug]: { ...prev, ...patch } };
    });
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/reservations/in-person", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dropId, customerName: name, items: saleItems }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Failed.");
        setBusy(false);
        return;
      }
      setName("");
      setRows({});
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch {
      setMsg("Network error.");
      setBusy(false);
    }
  }

  if (drops.length === 0) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-acid text-sm">
        ＋ Add in-person sale
      </button>
    );
  }

  return (
    <div className="nb-card mt-4 space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold" htmlFor="ip-drop">
          Drop
        </label>
        <select
          id="ip-drop"
          value={dropId}
          onChange={(e) => {
            setDropId(e.target.value);
            setRows({});
          }}
          className="rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-semibold"
        >
          {drops.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Buyer name"
          placeholder="Buyer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm"
        />
      </div>

      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-ink-500">
          <tr>
            <th className="py-2">Loaf</th>
            <th className="py-2">List</th>
            <th className="py-2">Qty</th>
            <th className="py-2">Price each</th>
            <th className="py-2 text-right">Favor</th>
          </tr>
        </thead>
        <tbody>
          {drop?.lines.map((l) => {
            const row = rows[l.productSlug];
            const qty = row?.quantity ?? 0;
            const price = row?.priceCents ?? l.listPriceCents;
            const favor = qty * Math.max(0, l.listPriceCents - price);
            return (
              <tr key={l.productSlug} className="border-t border-ink/10">
                <td className="py-2 font-semibold">{l.productName}</td>
                <td className="py-2 text-ink-500">{formatPrice(l.listPriceCents)}</td>
                <td className="py-2">
                  <input
                    type="number"
                    min={0}
                    step="1"
                    aria-label={`Quantity of ${l.productName}`}
                    value={qty || ""}
                    onChange={(e) => setRow(l.productSlug, { quantity: toQty(e.target.value) })}
                    className="w-16 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
                  />
                </td>
                <td className="py-2">
                  <span className="text-ink-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Price each for ${l.productName}`}
                    value={dollars(price)}
                    onChange={(e) => setRow(l.productSlug, { priceCents: toCents(e.target.value) })}
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
        <p className="text-sm">
          {saleActive ? (
            <>
              Total <strong>{formatPrice(collectedCents)}</strong>{" "}
              <span className="text-xs text-ink-500 line-through">
                {formatPrice(totalCents)}
              </span>{" "}
              <span className="text-xs font-semibold uppercase text-acid-600">
                Flash Sale −{promoPercentOff}%
              </span>
            </>
          ) : (
            <>
              Total <strong>{formatPrice(totalCents)}</strong>
            </>
          )}
          {favorsCents > 0 ? (
            <span className="ml-2 text-flame-700">favors {formatPrice(favorsCents)}</span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          {msg ? <span className="text-xs text-flame-700">{msg}</span> : null}
          <button type="button" onClick={() => setOpen(false)} className="btn-outline text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !name || saleItems.length === 0}
            onClick={submit}
            className="btn-acid text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
