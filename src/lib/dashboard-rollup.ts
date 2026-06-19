import type { DropFinancials } from "./types";

/** Group financial snapshots into weekly or monthly buckets. */
export type Period = "week" | "month";

export type RollupRow = {
  key: string;
  label: string;
  /** ms timestamp of the bucket start — for sorting (newest first). */
  sortMs: number;
  revenueCents: number;
  variableCostCents: number;
  fixedCostCents: number;
  totalCostCents: number;
  favorsCents: number;
  netProfitCents: number;
  unitsTotal: number;
  actualCollectedCents: number;
  drops: DropFinancials[];
};

/** ISO-8601 week number + week-year for a date. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7; // Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Local Monday 00:00 of the week containing `date`. */
function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - day);
  return d;
}

function bucketOf(date: Date, period: Period): {
  key: string;
  label: string;
  sortMs: number;
} {
  if (period === "month") {
    const y = date.getFullYear();
    const m = date.getMonth();
    return {
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      sortMs: new Date(y, m, 1).getTime(),
    };
  }
  const { year, week } = isoWeek(date);
  const start = weekStart(date);
  return {
    key: `${year}-W${String(week).padStart(2, "0")}`,
    label: `Week of ${start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`,
    sortMs: start.getTime(),
  };
}

const UNDATED = {
  key: "undated",
  label: "Undated",
  sortMs: -Infinity,
};

/**
 * Roll snapshots into period buckets, newest first. Snapshots without a usable
 * date land in an "Undated" bucket so nothing is silently dropped.
 */
export function rollupFinancials(
  rows: DropFinancials[],
  period: Period,
): RollupRow[] {
  const buckets = new Map<string, RollupRow>();

  for (const row of rows) {
    const iso = row.periodDate ?? row.savedAt;
    const date = iso ? new Date(iso) : null;
    const b =
      date && !Number.isNaN(date.getTime()) ? bucketOf(date, period) : UNDATED;

    let bucket = buckets.get(b.key);
    if (!bucket) {
      bucket = {
        key: b.key,
        label: b.label,
        sortMs: b.sortMs,
        revenueCents: 0,
        variableCostCents: 0,
        fixedCostCents: 0,
        totalCostCents: 0,
        favorsCents: 0,
        netProfitCents: 0,
        unitsTotal: 0,
        actualCollectedCents: 0,
        drops: [],
      };
      buckets.set(b.key, bucket);
    }

    bucket.revenueCents += row.revenueCents;
    bucket.variableCostCents += row.variableCostCents;
    bucket.fixedCostCents += row.fixedCostCents;
    bucket.totalCostCents += row.variableCostCents + row.fixedCostCents;
    bucket.favorsCents += row.favorsCents;
    bucket.netProfitCents += row.netProfitCents;
    bucket.unitsTotal += row.unitsTotal;
    bucket.actualCollectedCents += row.actualCollectedCents;
    bucket.drops.push(row);
  }

  return [...buckets.values()].sort((a, b) => b.sortMs - a.sortMs);
}

/** Grand totals across every snapshot (period-independent). */
export function totalFinancials(rows: DropFinancials[]) {
  return rows.reduce(
    (acc, r) => ({
      revenueCents: acc.revenueCents + r.revenueCents,
      totalCostCents: acc.totalCostCents + r.variableCostCents + r.fixedCostCents,
      favorsCents: acc.favorsCents + r.favorsCents,
      netProfitCents: acc.netProfitCents + r.netProfitCents,
      unitsTotal: acc.unitsTotal + r.unitsTotal,
      actualCollectedCents: acc.actualCollectedCents + r.actualCollectedCents,
    }),
    {
      revenueCents: 0,
      totalCostCents: 0,
      favorsCents: 0,
      netProfitCents: 0,
      unitsTotal: 0,
      actualCollectedCents: 0,
    },
  );
}
