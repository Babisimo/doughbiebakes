"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { csvDollars, toCsv } from "@/lib/csv";
import { formatPrice } from "@/lib/money";
import {
  componentsCostCents,
  computeProfitability,
  componentCostCents,
  type CostComponent,
  type FixedCost,
  type LoafLine,
  type ProfitabilityResult,
} from "@/lib/profitability";

type SeedLine = {
  slug: string;
  name: string;
  units: number;
  listPriceCents: number;
  defaultCostCents: number;
  sold: number;
};

export type CalculatorProps = {
  dropId: string;
  dropTitle: string;
  dropDate: string | null;
  drops: { id: string; title: string }[];
  seedLines: SeedLine[];
  actualCollectedCents: number;
  actualFavorsCents: number;
  savedFixedCosts: FixedCost[] | null;
};

type ClientComponent = CostComponent & { id: string };

type LineState = {
  slug: string;
  name: string;
  units: number;
  listPriceCents: number;
  salePriceCents: number;
  /** Flat cost used only when there are no itemized components. */
  manualCostCents: number;
  components: ClientComponent[];
};

type SavedLine = {
  units: number;
  salePriceCents: number;
  manualCostCents: number;
  components: CostComponent[];
};
type Persisted = { lines: Record<string, SavedLine>; fixed: FixedCost[] };

const storageKey = (dropId: string) => `doughbie:roi:${dropId}`;
const emptySubscribe = () => () => {};

function readSaved(dropId: string): Partial<Persisted> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(dropId));
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

let idCounter = 0;
const nextId = () => `c${idCounter++}`;
const withIds = (components: CostComponent[] = []): ClientComponent[] =>
  components.map((c) => ({ ...c, id: nextId() }));

function initialLines(dropId: string, seedLines: SeedLine[]): LineState[] {
  const saved = readSaved(dropId).lines ?? {};
  return seedLines.map((s) => {
    const o = saved[s.slug];
    return {
      slug: s.slug,
      name: s.name,
      units: o?.units ?? s.units,
      listPriceCents: s.listPriceCents,
      salePriceCents: o?.salePriceCents ?? s.listPriceCents,
      manualCostCents: o?.manualCostCents ?? s.defaultCostCents,
      components: withIds(o?.components),
    };
  });
}

/** Effective per-loaf cost: itemized total when present, else the flat cost. */
function effectiveCost(l: LineState): number {
  return l.components.length > 0
    ? componentsCostCents(l.components)
    : l.manualCostCents;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
function toCents(value: string): number {
  const n = Math.round(Number.parseFloat(value) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function toUnits(value: string): number {
  const n = Math.floor(Number.parseFloat(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function toNum(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function pct(ratio: number | null): string {
  return ratio == null ? "—" : `${(ratio * 100).toFixed(1)}%`;
}
function pctCsv(ratio: number | null): string {
  return ratio == null ? "" : (ratio * 100).toFixed(1);
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

function buildCalcCsv(
  dropTitle: string,
  lines: LineState[],
  result: ProfitabilityResult,
  actualCollectedCents: number,
): string {
  const rows: (string | number)[][] = [
    [`ROI — ${dropTitle}`],
    [],
    ["Loaf", "Units", "List price", "Sale price", "Cost/loaf", "Line profit"],
  ];
  for (const l of lines) {
    const cost = effectiveCost(l);
    rows.push([
      l.name,
      l.units,
      csvDollars(l.listPriceCents),
      csvDollars(l.salePriceCents),
      csvDollars(cost),
      csvDollars(l.units * (l.salePriceCents - cost)),
    ]);
  }
  rows.push(
    [],
    ["Summary"],
    ["Revenue (modeled)", csvDollars(result.revenueCents)],
    ["List value", csvDollars(result.listValueCents)],
    ["Favors/discounts given", csvDollars(result.favorsCents)],
    ["Variable cost", csvDollars(result.variableCostCents)],
    ["Fixed cost", csvDollars(result.fixedCostCents)],
    ["Total cost", csvDollars(result.totalCostCents)],
    ["Net profit", csvDollars(result.netProfitCents)],
    ["Gross margin %", pctCsv(result.grossMarginRatio)],
    ["ROI %", pctCsv(result.roiRatio)],
    ["Units", result.unitsTotal],
    ["Actually collected (Stripe)", csvDollars(actualCollectedCents)],
  );
  return toCsv(rows);
}

function MoneyInput({
  cents,
  onCents,
  ariaLabel,
  width = "w-20",
}: {
  cents: number;
  onCents: (c: number) => void;
  ariaLabel: string;
  width?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="text-ink-500">$</span>
      <input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        aria-label={ariaLabel}
        defaultValue={dollars(cents)}
        onChange={(e) => onCents(toCents(e.target.value))}
        className={`${width} rounded-lg border border-ink/20 bg-white px-2 py-1 text-right text-sm`}
      />
    </label>
  );
}

export function ProfitabilityCalculator({
  dropId,
  dropTitle,
  dropDate,
  drops,
  seedLines,
  actualCollectedCents,
  actualFavorsCents,
  savedFixedCosts,
}: CalculatorProps) {
  const router = useRouter();

  // Keyed by dropId in the parent, so this remounts per drop — lazy state can
  // safely seed from localStorage for the current drop.
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const [lines, setLines] = useState<LineState[]>(() =>
    initialLines(dropId, seedLines),
  );
  // Local edits win; otherwise fall back to what was last saved to Sanity.
  const [fixed, setFixed] = useState<FixedCost[]>(
    () => readSaved(dropId).fixed ?? savedFixedCosts ?? [],
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  // Persist edits for this drop (writing to an external store — no setState).
  useEffect(() => {
    const payload: Persisted = {
      lines: Object.fromEntries(
        lines.map((l) => [
          l.slug,
          {
            units: l.units,
            salePriceCents: l.salePriceCents,
            manualCostCents: l.manualCostCents,
            // Strip client-only ids before saving.
            components: l.components.map((c) => ({
              name: c.name,
              packagePriceCents: c.packagePriceCents,
              packageQty: c.packageQty,
              usedQty: c.usedQty,
              unit: c.unit,
            })),
          },
        ]),
      ),
      fixed,
    };
    try {
      window.localStorage.setItem(storageKey(dropId), JSON.stringify(payload));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [dropId, lines, fixed]);

  const loafLines = useMemo<LoafLine[]>(
    () =>
      lines.map((l) => ({
        slug: l.slug,
        name: l.name,
        units: l.units,
        listPriceCents: l.listPriceCents,
        salePriceCents: l.salePriceCents,
        unitCostCents: effectiveCost(l),
      })),
    [lines],
  );
  const result = useMemo(
    () => computeProfitability({ lines: loafLines, fixedCosts: fixed }),
    [loafLines, fixed],
  );

  // Any edit invalidates a prior "Saved" badge.
  const dirty = () => setSaveState((s) => (s === "idle" ? s : "idle"));
  const setLine = (slug: string, patch: Partial<LineState>) => {
    dirty();
    setLines((cur) => cur.map((l) => (l.slug === slug ? { ...l, ...patch } : l)));
  };
  const setComponents = (
    slug: string,
    fn: (cs: ClientComponent[]) => ClientComponent[],
  ) => {
    dirty();
    setLines((cur) =>
      cur.map((l) => (l.slug === slug ? { ...l, components: fn(l.components) } : l)),
    );
  };
  const mutateFixed = (fn: (cur: FixedCost[]) => FixedCost[]) => {
    dirty();
    setFixed(fn);
  };

  async function saveToHistory() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/admin/drop-financials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dropId,
          dropTitle,
          periodDate: dropDate,
          revenueCents: result.revenueCents,
          listValueCents: result.listValueCents,
          favorsCents: result.favorsCents,
          variableCostCents: result.variableCostCents,
          fixedCostCents: result.fixedCostCents,
          netProfitCents: result.netProfitCents,
          unitsTotal: result.unitsTotal,
          actualCollectedCents,
          fixedCosts: fixed,
        }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  // Server / first-hydration render: stable placeholder (no localStorage yet).
  if (!isClient) {
    return <div className="nb-card p-6 text-ink-500">Loading calculator…</div>;
  }

  const breakEvenPct =
    result.breakEvenRevenueCents && result.breakEvenRevenueCents > 0
      ? Math.min(100, (result.revenueCents / result.breakEvenRevenueCents) * 100)
      : result.revenueCents > 0
        ? 100
        : 0;
  const coversFixed =
    result.breakEvenRevenueCents != null &&
    result.revenueCents >= result.breakEvenRevenueCents;
  const profitTone =
    result.netProfitCents > 0
      ? "text-sage-700"
      : result.netProfitCents < 0
        ? "text-flame-700"
        : "text-ink";

  return (
    <div className="space-y-8">
      <div className="no-print flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-ink-700" htmlFor="drop">
          Drop:
        </label>
        <select
          id="drop"
          value={dropId}
          onChange={(e) =>
            router.push(`/admin/calculator?drop=${encodeURIComponent(e.target.value)}`)
          }
          className="rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-semibold"
        >
          {drops.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                `doughbie-roi-${dropId}.csv`,
                buildCalcCsv(dropTitle, lines, result, actualCollectedCents),
              )
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
            Print / PDF
          </button>
          {saveState === "saved" ? (
            <span className="text-xs font-semibold text-sage-700">✓ Saved</span>
          ) : saveState === "error" ? (
            <span className="text-xs font-semibold text-flame-700">
              Couldn&apos;t save
            </span>
          ) : null}
          <button
            type="button"
            onClick={saveToHistory}
            disabled={saveState === "saving"}
            className="btn-acid text-sm disabled:opacity-60"
          >
            {saveState === "saving" ? "Saving…" : "Save to history"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Revenue (modeled)" value={formatPrice(result.revenueCents)} />
        <Metric label="Total expenses" value={formatPrice(result.totalCostCents)} />
        <Metric
          label="Net profit"
          value={formatPrice(result.netProfitCents)}
          valueClass={profitTone}
        />
        <Metric label="ROI" value={pct(result.roiRatio)} valueClass={profitTone} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Metric label="Gross margin" value={pct(result.grossMarginRatio)} small />
        <Metric
          label="Favors / discounts given"
          value={formatPrice(result.favorsCents)}
          hint={`At full price these loaves are worth ${formatPrice(result.listValueCents)}.`}
          small
        />
        <Metric
          label="Favors given (actual)"
          value={formatPrice(actualFavorsCents)}
          hint="Real discounts handed out — from the per-loaf prices on actual orders & in-person sales."
          small
        />
        <Metric
          label="Actually collected (Stripe)"
          value={formatPrice(actualCollectedCents)}
          hint="Real money in for this drop so far — paid orders, reservations & club charges."
          small
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section>
          <h2 className="display text-2xl">Per loaf</h2>
          <p className="mt-1 text-sm text-ink-500">
            Drop a sale price below list to record a favor. Click{" "}
            <strong>Build</strong> on any loaf to itemize its cost from what you
            paid at the store.
          </p>
          <div className="nb-card mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink/15 text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-3 py-3">Loaf</th>
                  <th className="px-3 py-3">Units</th>
                  <th className="px-3 py-3">List</th>
                  <th className="px-3 py-3">Sale price</th>
                  <th className="px-3 py-3">Cost / loaf</th>
                  <th className="px-3 py-3 text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const cost = effectiveCost(l);
                  const lineProfit = l.units * (l.salePriceCents - cost);
                  const isOpen = open[l.slug] ?? false;
                  const itemized = l.components.length > 0;
                  return (
                    <FragmentRow key={l.slug}>
                      <tr className="border-b border-ink/10">
                        <td className="px-3 py-3 font-semibold">
                          {l.name}
                          {l.salePriceCents < l.listPriceCents ? (
                            <span className="ml-2 align-middle text-xs font-normal text-flame-700">
                              favor
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min={0}
                            step="1"
                            aria-label={`Units of ${l.name}`}
                            defaultValue={l.units}
                            onChange={(e) =>
                              setLine(l.slug, { units: toUnits(e.target.value) })
                            }
                            className="w-16 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right text-sm"
                          />
                        </td>
                        <td className="px-3 py-3 text-ink-500">
                          {formatPrice(l.listPriceCents)}
                        </td>
                        <td className="px-3 py-3">
                          <MoneyInput
                            cents={l.salePriceCents}
                            ariaLabel={`Sale price of ${l.name}`}
                            onCents={(c) => setLine(l.slug, { salePriceCents: c })}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            {itemized ? (
                              <span className="font-semibold">{formatPrice(cost)}</span>
                            ) : (
                              <MoneyInput
                                cents={l.manualCostCents}
                                ariaLabel={`Cost to make ${l.name}`}
                                onCents={(c) =>
                                  setLine(l.slug, { manualCostCents: c })
                                }
                              />
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setOpen((o) => ({ ...o, [l.slug]: !isOpen }))
                              }
                              className="no-print text-xs font-bold text-acid-600 underline decoration-2 hover:no-underline"
                            >
                              {itemized ? `Build (${l.components.length})` : "Build"}{" "}
                              {isOpen ? "▾" : "▸"}
                            </button>
                          </div>
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${
                            lineProfit < 0 ? "text-flame-700" : ""
                          }`}
                        >
                          {formatPrice(lineProfit)}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-b border-ink/10 bg-bone-200/40">
                          <td colSpan={6} className="px-3 py-4">
                            <CostBuilder
                              loafName={l.name}
                              components={l.components}
                              total={cost}
                              onAdd={() =>
                                setComponents(l.slug, (cs) => [
                                  ...cs,
                                  {
                                    id: nextId(),
                                    name: "",
                                    packagePriceCents: 0,
                                    packageQty: 0,
                                    usedQty: 0,
                                    unit: "g",
                                  },
                                ])
                              }
                              onPatch={(id, patch) =>
                                setComponents(l.slug, (cs) =>
                                  cs.map((c) =>
                                    c.id === id ? { ...c, ...patch } : c,
                                  ),
                                )
                              }
                              onRemove={(id) =>
                                setComponents(l.slug, (cs) =>
                                  cs.filter((c) => c.id !== id),
                                )
                              }
                            />
                          </td>
                        </tr>
                      ) : null}
                    </FragmentRow>
                  );
                })}
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-ink-500">
                      This drop has no loaves to cost out.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <h2 className="display text-2xl">Fixed costs</h2>
            <p className="mt-1 text-sm text-ink-500">
              One-off costs for this drop — gas, a packaging run, market fee.
              Saved on this device.
            </p>
            <ul className="mt-3 space-y-2">
              {fixed.map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label="Fixed cost name"
                    defaultValue={f.name}
                    placeholder="e.g. Gas"
                    onChange={(e) =>
                      mutateFixed((cur) =>
                        cur.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    className="flex-1 rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
                  />
                  <MoneyInput
                    cents={f.cents}
                    ariaLabel="Fixed cost amount"
                    onCents={(c) =>
                      mutateFixed((cur) =>
                        cur.map((x, j) => (j === i ? { ...x, cents: c } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove fixed cost"
                    onClick={() => mutateFixed((cur) => cur.filter((_, j) => j !== i))}
                    className="no-print rounded-lg px-2 py-1 text-ink-500 hover:text-flame-700"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => mutateFixed((cur) => [...cur, { name: "", cents: 0 }])}
              className="no-print btn-outline mt-3 text-sm"
            >
              ＋ Add fixed cost
            </button>
          </div>

          <div>
            <h2 className="display text-2xl">Break-even</h2>
            {result.breakEvenRevenueCents == null ? (
              <p className="mt-2 text-sm text-flame-700">
                {result.revenueCents <= 0
                  ? "Add some loaves and prices to see your break-even point."
                  : "Sale prices are below cost — you lose money on every loaf, so fixed costs can never be covered."}
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-700">
                  Need <strong>{formatPrice(result.breakEvenRevenueCents)}</strong>{" "}
                  in revenue to cover fixed costs. You&apos;re modeling{" "}
                  <strong>{formatPrice(result.revenueCents)}</strong>.
                </p>
                <div className="mt-2 h-4 w-full overflow-hidden rounded-full border border-ink/20 bg-white">
                  <div
                    className={`h-full ${coversFixed ? "bg-sage" : "bg-acid"}`}
                    style={{ width: `${breakEvenPct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {coversFixed
                    ? "✓ Past break-even — every extra loaf is profit."
                    : `${breakEvenPct.toFixed(0)}% of the way to covering fixed costs.`}
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      <p className="text-xs text-ink-500">
        Editing &ldquo;{dropTitle}&rdquo;. Everything you tweak here is saved in
        this browser only. To make a cost stick across devices, set the
        loaf&apos;s &ldquo;cost to make&rdquo; in the Studio.
      </p>
    </div>
  );
}

/** Tiny wrapper so a loaf can render two <tr>s (row + builder) under one key. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function CostBuilder({
  loafName,
  components,
  total,
  onAdd,
  onPatch,
  onRemove,
}: {
  loafName: string;
  components: ClientComponent[];
  total: number;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<CostComponent>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Cost build-up for <strong>{loafName}</strong>. Enter what a whole package
        cost, how much it holds, and how much one loaf uses (same unit). Use
        &ldquo;each&rdquo; for things like a single jalapeño.
      </p>
      {components.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-500">
              <tr>
                <th className="py-1 pr-2">Ingredient</th>
                <th className="py-1 pr-2">Package $</th>
                <th className="py-1 pr-2">Pkg holds</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2">Used / loaf</th>
                <th className="py-1 pr-2 text-right">= cost</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.id}>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      aria-label="Ingredient name"
                      defaultValue={c.name}
                      placeholder="e.g. Cheddar"
                      onChange={(e) => onPatch(c.id, { name: e.target.value })}
                      className="w-28 rounded-lg border border-ink/20 bg-white px-2 py-1"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <MoneyInput
                      cents={c.packagePriceCents}
                      ariaLabel="Package price"
                      width="w-20"
                      onCents={(v) => onPatch(c.id, { packagePriceCents: v })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label="Package quantity"
                      defaultValue={c.packageQty || ""}
                      onChange={(e) =>
                        onPatch(c.id, { packageQty: toNum(e.target.value) })
                      }
                      className="w-20 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      aria-label="Unit"
                      defaultValue={c.unit ?? ""}
                      placeholder="g"
                      onChange={(e) => onPatch(c.id, { unit: e.target.value })}
                      className="w-14 rounded-lg border border-ink/20 bg-white px-2 py-1"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label="Used per loaf"
                      defaultValue={c.usedQty || ""}
                      onChange={(e) =>
                        onPatch(c.id, { usedQty: toNum(e.target.value) })
                      }
                      className="w-20 rounded-lg border border-ink/20 bg-white px-2 py-1 text-right"
                    />
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold">
                    {formatPrice(componentCostCents(c))}
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      aria-label="Remove ingredient"
                      onClick={() => onRemove(c.id)}
                      className="px-1 text-ink-500 hover:text-flame-700"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onAdd} className="btn-outline text-xs">
          ＋ Add ingredient
        </button>
        {components.length > 0 ? (
          <span className="text-sm">
            Cost to make: <strong>{formatPrice(total)}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass = "",
  hint,
  small = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
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
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
