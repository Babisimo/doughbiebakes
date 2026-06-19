"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { csvDollars, toCsv } from "@/lib/csv";
import { formatPrice } from "@/lib/money";
import {
  rollupFinancials,
  totalFinancials,
  type Period,
  type RollupRow,
} from "@/lib/dashboard-rollup";
import type { DropFinancials } from "@/lib/types";

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}
function tone(cents: number): string {
  return cents > 0 ? "text-sage-700" : cents < 0 ? "text-flame-700" : "text-ink";
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildCsv(periods: RollupRow[], period: Period): string {
  const rows: (string | number)[][] = [
    [
      period === "week" ? "Week" : "Month",
      "Drop",
      "Revenue",
      "Total cost",
      "Net profit",
      "Margin %",
      "Favors",
      "Units",
      "Collected",
    ],
  ];
  for (const p of periods) {
    for (const d of p.drops) {
      const cost = d.variableCostCents + d.fixedCostCents;
      rows.push([
        p.label,
        d.dropTitle,
        csvDollars(d.revenueCents),
        csvDollars(cost),
        csvDollars(d.netProfitCents),
        d.revenueCents > 0
          ? ((d.netProfitCents / d.revenueCents) * 100).toFixed(1)
          : "",
        csvDollars(d.favorsCents),
        d.unitsTotal,
        csvDollars(d.actualCollectedCents),
      ]);
    }
    // Period subtotal.
    rows.push([
      `${p.label} — TOTAL`,
      "",
      csvDollars(p.revenueCents),
      csvDollars(p.totalCostCents),
      csvDollars(p.netProfitCents),
      p.revenueCents > 0
        ? ((p.netProfitCents / p.revenueCents) * 100).toFixed(1)
        : "",
      csvDollars(p.favorsCents),
      p.unitsTotal,
      csvDollars(p.actualCollectedCents),
    ]);
  }
  return toCsv(rows);
}

export function DashboardClient({ rows }: { rows: DropFinancials[] }) {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("month");
  const [adding, setAdding] = useState(false);

  const periods = useMemo(() => rollupFinancials(rows, period), [rows, period]);
  const totals = useMemo(() => totalFinancials(rows), [rows]);
  const maxProfit = useMemo(
    () => Math.max(1, ...periods.map((p) => Math.abs(p.netProfitCents))),
    [periods],
  );

  return (
    <div className="space-y-8">
      <div className="no-print flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-ink/20">
          {(["week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 text-sm font-semibold capitalize ${
                period === p ? "bg-acid text-ink" : "bg-white text-ink-700"
              }`}
            >
              {p === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
        <span className="text-sm text-ink-500">
          {rows.length} saved drop{rows.length === 1 ? "" : "s"} all-time
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(`doughbie-${period}ly.csv`, buildCsv(periods, period))
            }
            className="btn-outline text-sm"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-outline text-sm"
          >
            Print / Save as PDF
          </button>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="btn-acid text-sm"
          >
            ＋ Add past sales
          </button>
        </div>
      </div>

      {adding ? (
        <AddPastSalesForm
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {rows.length === 0 ? (
        <div className="nb-card p-6 text-ink-700">
          No saved drops yet. Either open the{" "}
          <a className="underline" href="/admin/calculator">
            ROI calculator
          </a>{" "}
          and hit <strong>Save to history</strong>, or use{" "}
          <strong>Add past sales</strong> above to backfill what you sold before
          the website.
        </div>
      ) : null}

      {/* All-time totals */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Revenue (all-time)" value={formatPrice(totals.revenueCents)} />
        <Metric label="Total cost" value={formatPrice(totals.totalCostCents)} />
        <Metric
          label="Net profit"
          value={formatPrice(totals.netProfitCents)}
          valueClass={tone(totals.netProfitCents)}
        />
        <Metric
          label="Profit margin"
          value={pct(totals.netProfitCents, totals.revenueCents)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Loaves sold" value={String(totals.unitsTotal)} small />
        <Metric label="Favors given" value={formatPrice(totals.favorsCents)} small />
        <Metric
          label="Collected (Stripe)"
          value={formatPrice(totals.actualCollectedCents)}
          small
        />
      </div>

      {/* Per-period breakdown */}
      <div className="space-y-5">
        <h2 className="display text-2xl">By {period}</h2>
        {periods.map((p) => (
          <section key={p.key} className="nb-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 px-5 py-4">
              <div>
                <h3 className="display text-xl">{p.label}</h3>
                <p className="text-xs text-ink-500">
                  {p.drops.length} drop{p.drops.length === 1 ? "" : "s"} ·{" "}
                  {p.unitsTotal} loaves
                </p>
              </div>
              <div className="text-right">
                <p className={`display text-2xl ${tone(p.netProfitCents)}`}>
                  {formatPrice(p.netProfitCents)}
                </p>
                <p className="text-xs text-ink-500">net profit</p>
              </div>
            </div>

            {/* Net-profit trend bar (relative to the biggest period). */}
            <div className="px-5 pt-4">
              <div className="h-3 w-full overflow-hidden rounded-full border border-ink/15 bg-white">
                <div
                  className={`h-full ${p.netProfitCents < 0 ? "bg-flame" : "bg-sage"}`}
                  style={{
                    width: `${(Math.abs(p.netProfitCents) / maxProfit) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-4">
              <Stat label="Revenue" value={formatPrice(p.revenueCents)} />
              <Stat label="Cost" value={formatPrice(p.totalCostCents)} />
              <Stat
                label="Margin"
                value={pct(p.netProfitCents, p.revenueCents)}
              />
              <Stat label="Favors" value={formatPrice(p.favorsCents)} />
            </div>

            <div className="overflow-x-auto border-t border-ink/10">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-5 py-2">Drop</th>
                    <th className="px-3 py-2 text-right">Revenue</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-right">Profit</th>
                    <th className="px-5 py-2 text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {p.drops.map((d) => (
                    <tr key={d.id} className="border-t border-ink/5">
                      <td className="px-5 py-2 font-semibold">{d.dropTitle}</td>
                      <td className="px-3 py-2 text-right">
                        {formatPrice(d.revenueCents)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatPrice(d.variableCostCents + d.fixedCostCents)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${tone(d.netProfitCents)}`}
                      >
                        {formatPrice(d.netProfitCents)}
                      </td>
                      <td className="px-5 py-2 text-right">{d.unitsTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass = "",
  small = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  small?: boolean;
}) {
  return (
    <div className="nb-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className={`display mt-1 ${small ? "text-2xl" : "text-3xl"} ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function toCents(value: string): number {
  const n = Math.round(Number.parseFloat(value) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function toUnits(value: string): number {
  const n = Math.floor(Number.parseFloat(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function AddPastSalesForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [month, setMonth] = useState("");
  const [revenue, setRevenue] = useState("");
  const [cost, setCost] = useState("");
  const [units, setUnits] = useState("");
  const [favors, setFavors] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!label.trim()) {
      setError("Give it a label, e.g. “Farmers market — May”.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/drop-financials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manual: true,
          title: label.trim(),
          // Bucket mid-month so timezones can't shift it to a neighbor.
          periodDate: month ? `${month}-15T12:00:00` : undefined,
          revenueCents: toCents(revenue),
          costCents: toCents(cost),
          favorsCents: toCents(favors),
          unitsTotal: toUnits(units),
        }),
      });
      if (!res.ok) {
        setError("Couldn't save — try again.");
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't save — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="no-print nb-card p-5">
      <h3 className="display text-xl">Add past sales</h3>
      <p className="mt-1 text-sm text-ink-500">
        Backfill anything sold before the website — a single loaf, a market day,
        or a whole month. It rolls into the totals like any other drop.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Label">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Farmers market — May"
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Month">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Loaves sold">
          <input
            type="number"
            min={0}
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-right text-sm"
          />
        </Field>
        <Field label="Revenue ($)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-right text-sm"
          />
        </Field>
        <Field label="Cost ($)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-right text-sm"
          />
        </Field>
        <Field label="Favors given ($, optional)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={favors}
            onChange={(e) => setFavors(e.target.value)}
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-right text-sm"
          />
        </Field>
      </div>
      {error ? <p className="mt-3 text-sm text-flame-700">{error}</p> : null}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="btn-acid text-sm disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save entry"}
        </button>
        <button type="button" onClick={onCancel} className="btn-outline text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
