"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  cToF,
  estimateFermentation,
  fToC,
  formatHours,
  type ProofState,
  type TempUnit,
} from "@/lib/fermentation-math";

// Slider/typed bounds per unit. We deliberately let the range run a little past
// the guide's 65–80°F so people can see the "out of range" warning rather than
// hitting an invisible wall.
const TEMP_BOUNDS: Record<TempUnit, { min: number; max: number; step: number }> = {
  F: { min: 60, max: 95, step: 1 },
  C: { min: 16, max: 35, step: 0.5 },
};
const RISE_BOUNDS = { min: 10, max: 120, step: 5 };
const STARTER_BOUNDS = { min: 5, max: 40, step: 1 };

const STORAGE_KEY = "doughbie:ferment-calc:v1";

type Settings = {
  unit: TempUnit;
  temp: number;
  starterPct: number;
  customRise: number | null;
};
const DEFAULTS: Settings = { unit: "F", temp: 77, starterPct: 20, customRise: null };

// localStorage as the source of truth, read via useSyncExternalStore so there's
// no load-effect and no hydration mismatch (the server snapshot is the
// defaults, and React swaps to the saved values right after hydration).
const subscribers = new Set<() => void>();
const settingsStore = {
  subscribe(cb: () => void) {
    subscribers.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      subscribers.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  getServerSnapshot(): string | null {
    return null;
  },
  save(next: Settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / private-mode failures
    }
    subscribers.forEach((cb) => cb()); // notify same-tab listeners
  },
};

function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULTS;
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    const num = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fallback;
    return {
      unit: s.unit === "C" ? "C" : "F",
      temp: num(s.temp, DEFAULTS.temp),
      starterPct: num(s.starterPct, DEFAULTS.starterPct),
      customRise:
        s.customRise === null ? null : num(s.customRise, DEFAULTS.customRise as number),
    };
  } catch {
    return DEFAULTS;
  }
}

// Where the numbers come from — surfaced in the "How this works" expander.
const SOURCES: { href: string; label: string; desc: string }[] = [
  {
    href: "https://thesourdoughjourney.com/the-ultimate-sourdough-bulk-fermentation-guide/",
    label: "The Ultimate Bulk Fermentation Guide",
    desc: "the overview that ties the method together",
  },
  {
    href: "https://thesourdoughjourney.com/wp-content/uploads/2024/08/TSJ-Dough-Temping-Guide.pdf",
    label: "Dough Temping Guide (PDF)",
    desc: "the temperature → time + recommended-rise table this tool reads from",
  },
  {
    href: "https://thesourdoughjourney.com/wp-content/uploads/2023/02/Bulk-O-Matic-Guide.pdf",
    label: "Bulk-O-Matic Guide (PDF)",
    desc: "the nine dough cues for judging doneness by eye",
  },
];

const PROOF_COPY: Record<ProofState, { badge: string; label: string; note: string }> = {
  under: {
    badge: "badge-acid",
    label: "Likely underproofed",
    note: "This is below the recommended pull point for this temperature — the loaf may be dense and tight.",
  },
  "on-target": {
    badge: "badge-sage",
    label: "On target",
    note: "Right in the recommended window for this dough temperature.",
  },
  over: {
    badge: "badge-flame",
    label: "Past the pull point",
    note: "This is beyond the recommended rise for this temperature — at warm temps the dough keeps fermenting downstream, so there's real overproofing risk.",
  },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const snap = (n: number, b: { min: number; max: number; step: number }) =>
  clamp(Math.round((Number.isFinite(n) ? n : b.min) / b.step) * b.step, b.min, b.max);

// A typed value box, paired with each slider. Reads as the big display number
// but is editable; out-of-bounds typing is corrected on blur by the parent.
function NumberBox({
  ariaLabel,
  value,
  suffix,
  min,
  max,
  step,
  onValue,
  onCommit,
}: {
  ariaLabel: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step: number;
  onValue: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onValue(v);
        }}
        onBlur={onCommit}
        className="display w-20 rounded-[var(--radius-card-sm)] border border-ink/15 bg-paper/60 px-2 py-1 text-right text-2xl tabular-nums focus:border-acid focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="display text-2xl text-ink-500">{suffix}</span>
    </div>
  );
}

export function FermentationCalculator() {
  const raw = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getServerSnapshot,
  );
  const settings = useMemo(() => parseSettings(raw), [raw]);
  const { unit, temp, starterPct, customRise } = settings;

  // Every setter merges a patch and persists — localStorage is the state.
  const patch = (p: Partial<Settings>) => settingsStore.save({ ...settings, ...p });
  const setTemp = (temp: number) => patch({ temp });
  const setStarterPct = (starterPct: number) => patch({ starterPct });
  const setCustomRise = (customRise: number | null) => patch({ customRise });

  const tempF = unit === "F" ? temp : cToF(temp);

  const estimate = useMemo(
    () =>
      estimateFermentation({
        tempF,
        targetRisePct: customRise ?? undefined,
        starterPct,
      }),
    [tempF, customRise, starterPct],
  );

  const proof = PROOF_COPY[estimate.proofState];
  const bounds = TEMP_BOUNDS[unit];
  const tempLabel = unit === "C" ? temp.toFixed(temp % 1 ? 1 : 0) : String(temp);

  function switchUnit(next: TempUnit) {
    if (next === unit) return;
    const converted = next === "C" ? Math.round(fToC(temp) * 2) / 2 : Math.round(cToF(temp));
    patch({ unit: next, temp: converted });
  }

  function resetDefaults() {
    settingsStore.save(DEFAULTS);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* ---- Inputs ---------------------------------------------------- */}
      <div className="nb-card space-y-7 p-6 sm:p-8">
        {/* Temperature */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="temp" className="display text-xl">
              Dough temperature
            </label>
            <div className="flex gap-1" role="group" aria-label="Temperature unit">
              {(["F", "C"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => switchUnit(u)}
                  aria-pressed={unit === u}
                  className={`badge ${unit === u ? "badge-sage" : ""}`}
                >
                  °{u}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <input
              id="temp"
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={clamp(temp, bounds.min, bounds.max)}
              onChange={(e) => setTemp(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-acid"
            />
            <NumberBox
              ariaLabel="Dough temperature value"
              value={temp}
              suffix={`°${unit}`}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              onValue={setTemp}
              onCommit={() => setTemp(snap(temp, bounds))}
            />
          </div>
          {estimate.outOfRange ? (
            <p className="text-sm text-acid-600">
              Outside the guide&apos;s tested 65–80°F (18–27°C) range — treat
              this as a loose extrapolation.
            </p>
          ) : null}
        </div>

        {/* Target rise */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="rise" className="display text-xl">
              Target rise
            </label>
            <button
              type="button"
              onClick={() =>
                setCustomRise(customRise === null ? estimate.recommendedRisePct : null)
              }
              aria-pressed={customRise === null}
              className={`badge ${customRise === null ? "badge-sage" : ""}`}
            >
              {customRise === null ? "Following recommended" : "Set my own"}
            </button>
          </div>
          <div className="flex items-center gap-4">
            <input
              id="rise"
              type="range"
              min={RISE_BOUNDS.min}
              max={RISE_BOUNDS.max}
              step={RISE_BOUNDS.step}
              value={clamp(estimate.targetRisePct, RISE_BOUNDS.min, RISE_BOUNDS.max)}
              onChange={(e) => setCustomRise(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-acid"
            />
            <NumberBox
              ariaLabel="Target rise percent"
              value={estimate.targetRisePct}
              suffix="%"
              min={RISE_BOUNDS.min}
              max={RISE_BOUNDS.max}
              step={1}
              onValue={(v) => setCustomRise(v)}
              onCommit={() =>
                setCustomRise(
                  customRise === null
                    ? null
                    : clamp(Math.round(customRise), RISE_BOUNDS.min, RISE_BOUNDS.max),
                )
              }
            />
          </div>
          <p className="text-sm text-ink-500">
            Recommended pull for this temperature:{" "}
            <strong className="text-ink-700">
              {estimate.recommendedRisePct}% rise
            </strong>{" "}
            (~{formatHours(estimate.recommendedHours)} at 20% starter).
          </p>
        </div>

        {/* Starter */}
        <div className="space-y-3">
          <label htmlFor="starter" className="display text-xl">
            Starter / levain
          </label>
          <div className="flex items-center gap-4">
            <input
              id="starter"
              type="range"
              min={STARTER_BOUNDS.min}
              max={STARTER_BOUNDS.max}
              step={STARTER_BOUNDS.step}
              value={clamp(starterPct, STARTER_BOUNDS.min, STARTER_BOUNDS.max)}
              onChange={(e) => setStarterPct(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-acid"
            />
            <NumberBox
              ariaLabel="Starter percent"
              value={starterPct}
              suffix="%"
              min={STARTER_BOUNDS.min}
              max={STARTER_BOUNDS.max}
              step={STARTER_BOUNDS.step}
              onValue={setStarterPct}
              onCommit={() => setStarterPct(snap(starterPct, STARTER_BOUNDS))}
            />
          </div>
          <p className="text-sm text-ink-500">
            Calibrated at 20%. This is a rough adjustment — your starter&apos;s{" "}
            <em>strength</em> (how lively it is at peak) matters as much as the
            percentage.
          </p>
        </div>

        {/* Persistence footer */}
        <div className="flex items-center justify-between gap-3 border-t border-ink/10 pt-4 text-sm text-ink-500">
          <span>Settings save automatically on this device.</span>
          <button type="button" onClick={resetDefaults} className="badge">
            Reset
          </button>
        </div>
      </div>

      {/* ---- Result ---------------------------------------------------- */}
      <div className="nb-card flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">
            Estimated bulk time
          </p>
          <p className="display mt-1 text-6xl text-grad-berry">
            {formatHours(estimate.hours)}
          </p>
          <p className="mt-2 text-ink-700">
            to a <strong>{estimate.targetRisePct}% rise</strong> at {tempLabel}°
            {unit} with a {starterPct}% starter.
          </p>
        </div>

        <div className="space-y-2 rounded-[var(--radius-card-sm)] bg-sage/40 p-4">
          <span className={`badge ${proof.badge}`}>{proof.label}</span>
          <p className="text-sm text-ink-700">{proof.note}</p>
        </div>

        <ul className="space-y-1.5 text-sm text-ink-500">
          <li>
            ⏱️ Time is the least reliable cue — confirm with the dough: doming,
            bubbles, a loose wobble, a sweet-ripe smell.
          </li>
          <li>
            📏 Measure rise by <em>volume</em> in a straight-walled vessel,
            timed from when the starter goes in.
          </li>
        </ul>

        <details className="group mt-auto rounded-[var(--radius-card-sm)] border border-ink/15 bg-paper/40 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink-700 [&::-webkit-details-marker]:hidden">
            How this works &amp; sources
            <span
              aria-hidden
              className="text-ink-500 transition-transform group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-ink-500">
            <p>
              Move the <strong className="text-ink-700">temperature</strong>{" "}
              slider and you&apos;re reading off a published measured table — the
              recommended rise and time are well-grounded. The{" "}
              <strong className="text-ink-700">starter</strong> slider is a
              rougher estimate: the source only notes a weak starter can take
              roughly twice as long, so trust it less the further you move from
              20%.
            </p>
            <p>
              Calibrated for one standard recipe —{" "}
              <strong className="text-ink-700">
                ~90% bread / 10% whole-wheat flour, 75% hydration, 2% salt
              </strong>{" "}
              — with bulk timed from when the starter goes into the dough.
              Whole-grain and fresh-milled flours ferment faster.
            </p>
            <ul className="space-y-1.5">
              {SOURCES.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-acid-600 underline"
                  >
                    {s.label}
                  </a>{" "}
                  — {s.desc}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
